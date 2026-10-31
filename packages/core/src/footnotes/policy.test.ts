/**
 * FN-6.3: document-level footnote numbering policy read from the root block's
 * RAW attrs. `documentFootnotePolicy(state)` validates the two attr keys and
 * falls back to the Google Docs default (`{ continuous, decimal }`) on absent
 * or invalid values.
 */
import { describe, it, expect } from "vitest";
import { documentFootnotePolicy } from "./policy";
import { createInitialEditorState } from "../editor/actions/test-helpers";
import { config } from "../editor/actions/test-helpers";
import { mergeBlockAttrs } from "../state";
import type { Document } from "../state";

/** Build a base Document (empty document) for policy reads. */
function baseDocument(): Document {
  return createInitialEditorState(config).document;
}

describe("documentFootnotePolicy", () => {
  it("defaults to continuous/decimal when the root has no policy attrs", () => {
    const document = baseDocument();
    expect(documentFootnotePolicy(document)).toEqual({
      reset: "continuous",
      format: "decimal",
    });
  });

  it("reads a valid reset + format from the root attrs", () => {
    let document = baseDocument();
    document = mergeBlockAttrs(document, document.rootId, {
      footnoteNumberingReset: "restart-per-section",
      footnoteNumberingFormat: "lower-roman",
    }).document;
    expect(documentFootnotePolicy(document)).toEqual({
      reset: "restart-per-section",
      format: "lower-roman",
    });
  });

  it("reads restart-per-page as a valid reset", () => {
    let document = baseDocument();
    document = mergeBlockAttrs(document, document.rootId, {
      footnoteNumberingReset: "restart-per-page",
    }).document;
    expect(documentFootnotePolicy(document).reset).toBe("restart-per-page");
  });

  it("falls back to continuous when reset is invalid", () => {
    let document = baseDocument();
    document = mergeBlockAttrs(document, document.rootId, {
      footnoteNumberingReset: "nonsense",
    }).document;
    expect(documentFootnotePolicy(document).reset).toBe("continuous");
  });

  it("falls back to decimal when format is invalid", () => {
    let document = baseDocument();
    document = mergeBlockAttrs(document, document.rootId, {
      footnoteNumberingFormat: "klingon",
    }).document;
    expect(documentFootnotePolicy(document).format).toBe("decimal");
  });

  it("falls back per-field independently (valid reset, invalid format)", () => {
    let document = baseDocument();
    document = mergeBlockAttrs(document, document.rootId, {
      footnoteNumberingReset: "restart-per-section",
      footnoteNumberingFormat: 42,
    }).document;
    expect(documentFootnotePolicy(document)).toEqual({
      reset: "restart-per-section",
      format: "decimal",
    });
  });

  it("accepts every valid CounterFormat", () => {
    const formats = [
      "decimal",
      "lower-roman",
      "upper-roman",
      "lower-alpha",
      "upper-alpha",
      "symbol",
    ] as const;
    for (const format of formats) {
      let document = baseDocument();
      document = mergeBlockAttrs(document, document.rootId, {
        footnoteNumberingFormat: format,
      }).document;
      expect(documentFootnotePolicy(document).format).toBe(format);
    }
  });
});
