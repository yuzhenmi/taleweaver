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

// charWidth 8, lineHeight 16 (the mock-shaper convention from text-measurer.test.ts → "ab" = 16).
const measurer = adaptShaperToMeasurer(createMockShaper(8, 16));
const cs = INITIAL_COMPUTED_STYLE;

// resolvePageFields reads only `plan.entries.length`, so a `{ length }` stub is type-correct.
function fakePlan(pageCount: number): { entries: { length: number } } {
  return { entries: { length: pageCount } };
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

  it("cross-ref-page spec is an interim no-op: no global value and no width entry (kept out of convergence)", () => {
    // S3 interim: the real target-page resolution lands in S4. Until then the
    // cross-ref-page branch must emit NEITHER a global value NOR a width entry —
    // the absence of a width entry is what keeps the field out of width-convergence
    // and the dev-mode `needed <= reserved` invariant. A regression that fabricated
    // a width here (e.g. by falling into the page-number path) would fail this.
    const { globalFieldValues, maxValueWidthByKey } = resolvePageFields(fakePlan(5), [crossRefSpec()], measurer);
    expect(globalFieldValues.has("blk/inline/0")).toBe(false);
    expect(maxValueWidthByKey.has("blk/inline/0")).toBe(false);
  });

  it("empty field set → empty maps", () => {
    const { globalFieldValues, maxValueWidthByKey } = resolvePageFields(fakePlan(3), [], measurer);
    expect(globalFieldValues.size).toBe(0);
    expect(maxValueWidthByKey.size).toBe(0);
  });
});
