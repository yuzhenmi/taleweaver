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
import type { State } from "../state";

/** Build a base State (empty document) for policy reads. */
function baseState(): State {
  return createInitialEditorState(config).state;
}

describe("documentFootnotePolicy", () => {
  it("defaults to continuous/decimal when the root has no policy attrs", () => {
    const state = baseState();
    expect(documentFootnotePolicy(state)).toEqual({
      reset: "continuous",
      format: "decimal",
    });
  });

  it("reads a valid reset + format from the root attrs", () => {
    let state = baseState();
    state = mergeBlockAttrs(state, state.rootId, {
      footnoteNumberingReset: "restart-per-section",
      footnoteNumberingFormat: "lower-roman",
    }).state;
    expect(documentFootnotePolicy(state)).toEqual({
      reset: "restart-per-section",
      format: "lower-roman",
    });
  });

  it("reads restart-per-page as a valid reset", () => {
    let state = baseState();
    state = mergeBlockAttrs(state, state.rootId, {
      footnoteNumberingReset: "restart-per-page",
    }).state;
    expect(documentFootnotePolicy(state).reset).toBe("restart-per-page");
  });

  it("falls back to continuous when reset is invalid", () => {
    let state = baseState();
    state = mergeBlockAttrs(state, state.rootId, {
      footnoteNumberingReset: "nonsense",
    }).state;
    expect(documentFootnotePolicy(state).reset).toBe("continuous");
  });

  it("falls back to decimal when format is invalid", () => {
    let state = baseState();
    state = mergeBlockAttrs(state, state.rootId, {
      footnoteNumberingFormat: "klingon",
    }).state;
    expect(documentFootnotePolicy(state).format).toBe("decimal");
  });

  it("falls back per-field independently (valid reset, invalid format)", () => {
    let state = baseState();
    state = mergeBlockAttrs(state, state.rootId, {
      footnoteNumberingReset: "restart-per-section",
      footnoteNumberingFormat: 42,
    }).state;
    expect(documentFootnotePolicy(state)).toEqual({
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
      let state = baseState();
      state = mergeBlockAttrs(state, state.rootId, {
        footnoteNumberingFormat: format,
      }).state;
      expect(documentFootnotePolicy(state).format).toBe(format);
    }
  });
});
