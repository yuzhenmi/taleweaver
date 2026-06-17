import { describe, it, expect } from "vitest";
import {
  buildSectionPlan,
  sectionStateAt,
  isSectionBox,
  IMPLICIT_SECTION_PLAN,
} from "./section-plan";
import type { SectionPlan } from "./section-plan";
import { createElementBox } from "@taleweaver/core";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { ComputedStyle } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}
import type { PageConfig } from "./page-config";
import { DEFAULT_COLUMN_CONFIG } from "@taleweaver/core";
import type { ColumnConfig } from "@taleweaver/core";

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

/** A doc-root ElementBox carrying its own metadata (e.g. a doc-wide header/footer). */
function docRootWithMeta(
  children: readonly RenderNode[],
  metadata: Record<string, unknown>,
): ElementBox {
  return withComputed(
    createElementBox("doc", { display: "block" }, children, metadata),
    "block",
  );
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
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
    });
  });
});

// --- buildSectionPlan --------------------------------------------------------

describe("buildSectionPlan", () => {
  it("section-less doc → a single implicit leading boundary", () => {
    const root = docRoot([para("p1"), para("p2"), para("p3")]);
    expect(buildSectionPlan(root, DOC_WIDE)).toEqual({
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
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
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
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
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [
        { startFlattenedIndex: 0, sectionId: "sec1" },
        { startFlattenedIndex: 1, sectionId: "sec2" },
      ],
    });
  });

  it("single section(a,b,c) with no leading block → [{0,sec}] (section starts at 0)", () => {
    const root = docRoot([section("sec", [para("a"), para("b"), para("c")])]);
    expect(buildSectionPlan(root, DOC_WIDE)).toEqual({
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
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
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
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
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 1, sectionId: "real" },
      ],
    });
  });

  it("de-dups an empty leading section into the next section (still strictly increasing)", () => {
    const root = docRoot([section("empty", []), section("real", [para("a"), para("b")])]);
    expect(buildSectionPlan(root, DOC_WIDE)).toEqual({
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
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
      expect(nth(plan.boundaries, i, "boundary").startFlattenedIndex).toBeGreaterThan(
        nth(plan.boundaries, i - 1, "boundary").startFlattenedIndex,
      );
    }
    expect(plan).toEqual({
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
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
    expect(nth(IMPLICIT_SECTION_PLAN.boundaries, 0, "boundary").pageConfig).toBeUndefined();
  });
});

// --- buildSectionPlan: per-section header/footer ids (C.2c T2) ---------------
//
// A section may carry `headerBlockId` / `footerBlockId` in its attrs (the ids of
// the templateContents bodies that lay out into each page's header/footer slot).
// The section component stamps them RAW into metadata (like the geometry attrs);
// `makeSectionBoundary` carries them onto the boundary, and the doc-root box's
// own metadata feeds the implicit/leading boundary (a section-less doc with a
// doc-root header).

describe("buildSectionPlan — per-section header/footer ids", () => {
  it("a section WITH headerBlockId / footerBlockId → boundary carries them", () => {
    const root = docRoot([
      para("p1"),
      section("sec", [para("a")], { headerBlockId: "hdr", footerBlockId: "ftr" }),
    ]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary).toBeDefined();
    expect(secBoundary?.headerBlockId).toBe("hdr");
    expect(secBoundary?.footerBlockId).toBe("ftr");
  });

  it("a section with NO own header/footer AND a doc root with none → both undefined (no id to inherit)", () => {
    // `docRoot` carries no metadata, so there is no doc-root id to fall back to;
    // contrast the `docRootWithMeta` cases below where the section inherits one.
    const root = docRoot([para("p1"), section("sec", [para("a")])]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary).toBeDefined();
    expect(secBoundary?.headerBlockId).toBeUndefined();
    expect(secBoundary?.footerBlockId).toBeUndefined();
  });

  it("a non-string header/footer value → coerced to undefined", () => {
    const root = docRoot([
      section("sec", [para("a")], { headerBlockId: 42, footerBlockId: { x: 1 } }),
    ]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary?.headerBlockId).toBeUndefined();
    expect(secBoundary?.footerBlockId).toBeUndefined();
  });

  it("a section with NO own header/footer falls back to the doc-root ids (Finding 1: header dropped after a section break at index 0)", () => {
    // Repro: a doc carrying a doc-root header/footer, whose index-0 child is a
    // section with attrs `{}` (exactly the shape `applySectionBreak` produces).
    // The section opens at flattened index 0, so the implicit-leading boundary —
    // which would otherwise carry the doc-root ids — is never prepended. Without
    // the doc-root fallback the running content silently vanishes from every page.
    const root = docRootWithMeta(
      [section("sec", [para("a"), para("b")])],
      { headerBlockId: "docHdr", footerBlockId: "docFtr" },
    );
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary).toBeDefined();
    expect(secBoundary?.headerBlockId).toBe("docHdr");
    expect(secBoundary?.footerBlockId).toBe("docFtr");
  });

  it("a section's OWN header/footer overrides the doc-root ids", () => {
    const root = docRootWithMeta(
      [section("sec", [para("a")], { headerBlockId: "secHdr", footerBlockId: "secFtr" })],
      { headerBlockId: "docHdr", footerBlockId: "docFtr" },
    );
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary?.headerBlockId).toBe("secHdr");
    expect(secBoundary?.footerBlockId).toBe("secFtr");
  });

  it("doc-root metadata header/footer ids → the implicit/leading boundary carries them (section-less doc)", () => {
    // A section-less doc whose ROOT box carries the header/footer ids (the
    // implicit-section default lives on the doc root). buildSectionPlan reads
    // them off `cascadedRoot.metadata` onto the implicit `{0,null}` boundary.
    const root = withComputed(
      createElementBox("doc", { display: "block" }, [para("p1"), para("p2")], {
        headerBlockId: "docHdr",
        footerBlockId: "docFtr",
      }),
      "block",
    );
    const plan = buildSectionPlan(root, DOC_WIDE);
    expect(plan.boundaries.length).toBe(1);
    const implicit = nth(plan.boundaries, 0, "boundary");
    expect(implicit.sectionId).toBeNull();
    expect(implicit.headerBlockId).toBe("docHdr");
    expect(implicit.footerBlockId).toBe("docFtr");
  });

  it("doc-root ids feed the LEADING implicit boundary AND a trailing section inherits them (link-to-previous default)", () => {
    // [p1, section(...)] → boundaries [{0,null},{1,sec}]. The doc-root ids land on
    // the implicit leading boundary; the trailing section declares no own header,
    // so it INHERITS the doc-root id — matching Google Docs' "link to previous"
    // default and the `effectiveDefaultColumns` column-fallback parity. (The footer
    // stays undefined: the doc root set no footer to inherit.)
    const root = withComputed(
      createElementBox(
        "doc",
        { display: "block" },
        [para("p1"), section("sec", [para("a")])],
        { headerBlockId: "docHdr" },
      ),
      "block",
    );
    const plan = buildSectionPlan(root, DOC_WIDE);
    const implicit = plan.boundaries.find((b) => b.sectionId === null);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(implicit?.headerBlockId).toBe("docHdr");
    expect(implicit?.footerBlockId).toBeUndefined();
    expect(secBoundary?.headerBlockId).toBe("docHdr");
    expect(secBoundary?.footerBlockId).toBeUndefined();
  });

  it("doc-root with NO header/footer metadata → implicit boundary undefined", () => {
    const root = docRoot([para("p1")]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const implicit = nth(plan.boundaries, 0, "boundary");
    expect(implicit.headerBlockId).toBeUndefined();
    expect(implicit.footerBlockId).toBeUndefined();
  });
});

// --- sectionStateAt ----------------------------------------------------------

describe("sectionStateAt", () => {
  // plan: [{0,null},{1,sec},{4,sec2}]
  const plan: SectionPlan = {
    effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
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
    effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
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

// --- sectionStateAt: header/footer surfacing (C.2c T2) -----------------------
//
// The measure pass tags each page with the active section's header/footer body
// ids (so a later task lays them into the page slots). `sectionStateAt` must
// surface the active boundary's `headerBlockId`/`footerBlockId` (undefined when
// the active boundary carries none).

describe("sectionStateAt — header/footer ids", () => {
  // plan: [{0,null, docHdr}, {1,sec, hdr/ftr}, {4,sec2}]
  const plan: SectionPlan = {
    effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
    boundaries: [
      { startFlattenedIndex: 0, sectionId: null, headerBlockId: "docHdr" as BlockId },
      {
        startFlattenedIndex: 1,
        sectionId: "sec" as BlockId,
        headerBlockId: "hdr" as BlockId,
        footerBlockId: "ftr" as BlockId,
      },
      { startFlattenedIndex: 4, sectionId: "sec2" as BlockId },
    ],
  };

  it("active boundary WITH header/footer ids → surfaced", () => {
    const at1 = sectionStateAt(plan, 1);
    expect(at1.headerBlockId).toBe("hdr");
    expect(at1.footerBlockId).toBe("ftr");
    // between boundaries → still the active (sec) boundary's ids.
    const at3 = sectionStateAt(plan, 3);
    expect(at3.headerBlockId).toBe("hdr");
    expect(at3.footerBlockId).toBe("ftr");
  });

  it("implicit leading boundary's header id is surfaced at index 0", () => {
    const at0 = sectionStateAt(plan, 0);
    expect(at0.headerBlockId).toBe("docHdr");
    expect(at0.footerBlockId).toBeUndefined();
  });

  it("active boundary WITHOUT header/footer ids → undefined", () => {
    const at4 = sectionStateAt(plan, 4);
    expect(at4.headerBlockId).toBeUndefined();
    expect(at4.footerBlockId).toBeUndefined();
  });

  it("IMPLICIT_SECTION_PLAN never surfaces header/footer ids", () => {
    expect(sectionStateAt(IMPLICIT_SECTION_PLAN, 0).headerBlockId).toBeUndefined();
    expect(sectionStateAt(IMPLICIT_SECTION_PLAN, 0).footerBlockId).toBeUndefined();
  });
});

// --- buildSectionPlan: per-section columnConfig (multi-column slice 1) --------
//
// A section may carry `columnCount` / `columnGap` / `columnRule` in its attrs
// (Google-Docs Format ▸ Columns). The section component stamps them RAW into
// metadata (like the geometry attrs); `makeSectionBoundary` resolves them over
// the doc-default column config and stamps `SectionBoundary.columnConfig` ONLY
// when it differs from the doc default (the no-override path stays inert). This
// is the C.2b-2 pageConfig threading parallel — INERT in slice 1 (no consumer).

describe("buildSectionPlan — per-section columnConfig", () => {
  it("a section WITH a columnCount override → boundary.columnConfig reflects it", () => {
    const root = docRoot([
      para("p1"),
      section("sec", [para("a")], { columnCount: 2 }),
    ]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary).toBeDefined();
    expect(secBoundary?.columnConfig?.columnCount).toBe(2);
    // The rest is inherited from the doc default (single-column gap, no rule).
    expect(secBoundary?.columnConfig?.columnGap).toBe(DEFAULT_COLUMN_CONFIG.columnGap);
    expect(secBoundary?.columnConfig?.columnRule).toBeNull();
    // INERT/orthogonality: a column-only override does NOT perturb page geometry
    // (no pageConfig stamped). Columns are independent of pagination — slice 1
    // is purely additive vocabulary (no measure/layout consumer reads columnConfig).
    expect(secBoundary?.pageConfig).toBeUndefined();
  });

  it("a section with NO column attrs → columnConfig undefined (inert no-override path)", () => {
    const root = docRoot([para("p1"), section("sec", [para("a")])]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary).toBeDefined();
    expect(secBoundary?.columnConfig).toBeUndefined();
  });

  it("a section with columnCount 1 → columnConfig undefined (single-column = doc default)", () => {
    const root = docRoot([section("sec", [para("a")], { columnCount: 1 })]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary?.columnConfig).toBeUndefined();
  });

  it("the implicit leading boundary never carries a columnConfig", () => {
    const root = docRoot([
      para("p1"),
      section("sec", [para("a")], { columnCount: 3 }),
    ]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const implicit = plan.boundaries.find((b) => b.sectionId === null);
    expect(implicit?.columnConfig).toBeUndefined();
  });

  it("a doc-default columns override (3rd arg) feeds the implicit boundary via no-op gating", () => {
    // A section echoing the doc-default column count back is a no-op ⇒ no stamp.
    const docDefault: ColumnConfig = { columnCount: 2, columnGap: 48, columnRule: null };
    const root = docRoot([section("sec", [para("a")], { columnCount: 2 })]);
    const plan = buildSectionPlan(root, DOC_WIDE, docDefault);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    // Equal to docDefault ⇒ no columnConfig stamped (inert).
    expect(secBoundary?.columnConfig).toBeUndefined();
  });

  it("doc-root metadata columnCount → the implicit boundary's effective default differs ⇒ a section echoing the engine default stamps", () => {
    // The doc root declares columnCount 2; a child section with no override
    // inherits that default, so its (absent) override resolves EQUAL to the
    // doc default ⇒ still no stamp. But a section overriding back to 1 differs.
    const root = withComputed(
      createElementBox("doc", { display: "block" }, [section("sec", [para("a")], { columnCount: 1 })], {
        columnCount: 2,
      }),
      "block",
    );
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary?.columnConfig?.columnCount).toBe(1);
    // The resolved doc-wide default is EXPOSED on the plan (the slice-2 fallback
    // for boundaries with no override) — it reflects the doc-root metadata (2),
    // NOT the raw DOC_WIDE/engine single-column default.
    expect(plan.effectiveDefaultColumns.columnCount).toBe(2);
  });

  it("sectionStateAt surfaces the active boundary's columnConfig", () => {
    const cfg: ColumnConfig = { columnCount: 2, columnGap: 48, columnRule: null };
    const plan: SectionPlan = {
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 1, sectionId: "sec" as BlockId, columnConfig: cfg },
        { startFlattenedIndex: 4, sectionId: "sec2" as BlockId },
      ],
    };
    expect(sectionStateAt(plan, 1).columnConfig).toBe(cfg);
    expect(sectionStateAt(plan, 3).columnConfig).toBe(cfg);
    expect(sectionStateAt(plan, 0).columnConfig).toBeUndefined();
    expect(sectionStateAt(plan, 4).columnConfig).toBeUndefined();
  });

  it("IMPLICIT_SECTION_PLAN never surfaces a columnConfig", () => {
    expect(sectionStateAt(IMPLICIT_SECTION_PLAN, 0).columnConfig).toBeUndefined();
    expect(sectionStateAt(IMPLICIT_SECTION_PLAN, 99).columnConfig).toBeUndefined();
  });
});
