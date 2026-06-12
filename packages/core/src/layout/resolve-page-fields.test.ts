/**
 * F-1: `resolvePageFields` — the pure post-pagination pass. `page-count` resolves
 * once from `plan.entries.length`; `page-number` resolves per-page at materialize
 * (no global entry). `maxValueWidthByKey` is the widest value width each field can
 * show, measured via a TextMeasurer (drives the §4.4 convergence comparison).
 */
import { describe, it, expect } from "vitest";
import { resolvePageFields } from "./resolve-page-fields";
import type { FieldSpec } from "./collect-page-fields";
import { createMockShaper } from "./mock-shaper";
import { adaptShaperToMeasurer } from "./text-measurer";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { asBlockId } from "../state";
import { BROKEN_CROSS_REFERENCE_TEXT } from "../render/resolve-cross-reference";
import { formatCounter } from "../styles/format-counter";

// charWidth 8, lineHeight 16 (the mock-shaper convention from text-measurer.test.ts → "ab" = 16).
const measurer = adaptShaperToMeasurer(createMockShaper(8, 16));
const cs = INITIAL_COMPUTED_STYLE;

// resolvePageFields reads `plan.entries.length` and (for cross-ref-page) `plan.pageSpanOfBlock`,
// so the stub provides both — `spans` lets a test inject a target block's page span.
function fakePlan(
  pageCount: number,
  spans: Record<string, { first: number; last: number }> = {},
): { entries: { length: number }; pageSpanOfBlock(key: string): { first: number; last: number } | null } {
  return { entries: { length: pageCount }, pageSpanOfBlock: (key) => spans[key] ?? null };
}

function spec(fieldType: "page-number" | "page-count", embedKey = "h/inline/0", numberStyle: "decimal" | "lower-roman" = "decimal"): FieldSpec {
  return { embedKey, host: "template", hostBlockId: asBlockId("h"), fieldType, numberStyle, computedStyle: cs };
}

function crossRefSpec(embedKey = "blk/inline/0"): FieldSpec {
  return { embedKey, host: "main", hostBlockId: asBlockId("blk"), fieldType: "cross-ref-page", targetId: asBlockId("tgt"), numberStyle: "decimal", computedStyle: cs };
}

describe("resolvePageFields (F-1 resolution)", () => {
  it("resolves page-count to the total page count, keyed by embedKey", () => {
    const { globalFieldValues } = resolvePageFields(fakePlan(3), [spec("page-count")], measurer);
    expect(globalFieldValues.get("h/inline/0")).toBe("3");
  });

  it("page-number specs get no global value (resolved per-page at materialize)", () => {
    const { globalFieldValues } = resolvePageFields(fakePlan(5), [spec("page-number")], measurer);
    expect(globalFieldValues.has("h/inline/0")).toBe(false);
  });

  it("reports the max value width per field via the measurer", () => {
    const { maxValueWidthByKey } = resolvePageFields(fakePlan(42), [spec("page-count")], measurer);
    expect(maxValueWidthByKey.get("h/inline/0")).toBe(measurer.measureWidth("42", cs)); // "42" → 16px
  });

  it("page-number's widest value is the LAST page's number for decimal (monotonic digit count)", () => {
    // 12 pages → widest page-number is "12" (2 digits = 16px), not "1".
    const { maxValueWidthByKey } = resolvePageFields(fakePlan(12), [spec("page-number")], measurer);
    expect(maxValueWidthByKey.get("h/inline/0")).toBe(measurer.measureWidth("12", cs));
  });

  it("page-number's widest value handles NON-monotonic styles (roman): a mid-sequence value can be widest", () => {
    // 10 pages, lower-roman: page 8 = "viii" (4 glyphs) is WIDER than the last page 10 = "x" (1 glyph).
    // The reservation must cover the widest of ALL pages, not just the last — `maxValueWidthByKey`
    // IS the §4.4 convergence loop's overflow signal, so a last-page under-estimate would under-reserve
    // the slot and let page 8's header overflow. Must report "viii"'s width (32px), not "x"'s (8px).
    const { maxValueWidthByKey } = resolvePageFields(
      fakePlan(10),
      [spec("page-number", "h/inline/0", "lower-roman")],
      measurer,
    );
    expect(maxValueWidthByKey.get("h/inline/0")).toBe(measurer.measureWidth("viii", cs));
  });

  it("honors a non-decimal numberStyle for the page-count value", () => {
    const { globalFieldValues } = resolvePageFields(fakePlan(4), [spec("page-count", "h/inline/0", "lower-roman")], measurer);
    expect(globalFieldValues.get("h/inline/0")).toBe("iv"); // formatCounter(4, "lower-roman")
  });

  it("two distinct fields get distinct entries (keyed by embedKey)", () => {
    const { globalFieldValues, maxValueWidthByKey } = resolvePageFields(
      fakePlan(7),
      [spec("page-count", "a/inline/0"), spec("page-count", "b/inline/0")],
      measurer,
    );
    expect(globalFieldValues.get("a/inline/0")).toBe("7");
    expect(globalFieldValues.get("b/inline/0")).toBe("7");
    expect(maxValueWidthByKey.size).toBe(2);
  });

  it("resolves a cross-ref-page to the target's 1-based FIRST page number", () => {
    const { globalFieldValues, maxValueWidthByKey } = resolvePageFields(
      fakePlan(10, { tgt: { first: 4, last: 4 } }),
      [crossRefSpec()],
      measurer,
    );
    expect(globalFieldValues.get("blk/inline/0")).toBe("5"); // span.first 4 → page 5
    expect(maxValueWidthByKey.get("blk/inline/0")).toBe(measurer.measureWidth("5", cs));
  });

  it("resolves a cross-ref-page with a non-decimal numberStyle", () => {
    // crossRefSpec hardcodes numberStyle "decimal"; build a lower-roman variant inline.
    const spec: FieldSpec = {
      embedKey: "blk/inline/0", host: "main", hostBlockId: asBlockId("blk"),
      fieldType: "cross-ref-page", targetId: asBlockId("tgt"), numberStyle: "lower-roman", computedStyle: cs,
    };
    const { globalFieldValues } = resolvePageFields(fakePlan(10, { tgt: { first: 4, last: 4 } }), [spec], measurer);
    expect(globalFieldValues.get("blk/inline/0")).toBe("v"); // formatCounter(5, "lower-roman")
  });

  it("a cross-ref-page whose target is NOT in the plan resolves to broken-ref ('' global + broken-ref width)", () => {
    const { globalFieldValues, maxValueWidthByKey } = resolvePageFields(fakePlan(10), [crossRefSpec()], measurer);
    expect(globalFieldValues.get("blk/inline/0")).toBe("");
    expect(maxValueWidthByKey.get("blk/inline/0")).toBe(measurer.measureWidth(BROKEN_CROSS_REFERENCE_TEXT, cs));
  });

  it("a cross-ref-page whose target IS its own host block resolves to the host's own page (self-ref, no special-casing)", () => {
    // LDF-3 (self-ref): a page-ref targeting its OWN host block is a legal, deterministic
    // value — it resolves via `pageSpanOfBlock(hostId)` to the page the ref renders on. No
    // recursion, no infinite loop, no special case: it's a plain plan lookup. Host "blk"
    // sits on page span { first: 3 } ⇒ the field shows "4" (1-based).
    const selfRefSpec: FieldSpec = {
      embedKey: "blk/inline/0", host: "main", hostBlockId: asBlockId("blk"),
      fieldType: "cross-ref-page", targetId: asBlockId("blk"), numberStyle: "decimal", computedStyle: cs,
    };
    const { globalFieldValues } = resolvePageFields(
      fakePlan(10, { blk: { first: 3, last: 3 } }),
      [selfRefSpec],
      measurer,
    );
    expect(globalFieldValues.get("blk/inline/0")).toBe(formatCounter(4, "decimal")); // span.first 3 → page 4
  });

  it("empty field set → empty maps", () => {
    const { globalFieldValues, maxValueWidthByKey } = resolvePageFields(fakePlan(3), [], measurer);
    expect(globalFieldValues.size).toBe(0);
    expect(maxValueWidthByKey.size).toBe(0);
  });
});
