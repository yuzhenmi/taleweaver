// packages/core/src/editor/actions/selection-guards.test.ts
//
// Unit tests for the shared expanded-selection guards extracted from the
// DELETE_BACKWARD / DELETE_FORWARD / INSERT_TEXT / SPLIT_NODE handlers.
//
// `isCrossContextSelection` — the C.2c §6 cross-CONTEXT predicate (main body ↔
//   header/footer body). True iff anchor and focus resolve to different
//   selection-context roots.
// `expandedSpanCollapsePoint` — the deletable-span guard + collapse point shared
//   by the three delete/split handlers: spanStart when deletable, null when a
//   block doesn't resolve or the span is cross-parent.
//
// These are pure-predicate tests; the no-regression guard for the handlers
// themselves lives in header-boundary-guards.test.ts and the per-action suites.

import { describe, it, expect } from "vitest";
import { createPosition, createSpan, spanStart } from "../../state";
import type { State, BlockId } from "../../state";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../../test-utils/state-builders";
import {
  isCrossContextSelection,
  expandedSpanCollapsePoint,
} from "./selection-guards";

const BODY_P1 = "p" as BlockId;
const BODY_P2 = "p2" as BlockId;
const HDR_P1 = "hdr-c1" as BlockId;

/**
 * Two main body paragraphs under `doc`, plus a header template body (a
 * container ROOT with two child paragraphs) in templateContents. Mirrors
 * header-boundary-guards.test.ts's fixture so the contexts are exercised the
 * same way.
 */
function buildStateWithHeaderBody(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p2" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "p2",
        inlineContent: inlineContent([text("body text")]),
      }),
      buildBlock({
        id: "p2",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p",
        inlineContent: inlineContent([text("more body")]),
      }),
    ],
    templateContents: [
      buildBlock({
        id: "hdr-root",
        type: "document",
        parentId: null,
        firstChildId: "hdr-c1",
        lastChildId: "hdr-c2",
      }),
      buildBlock({
        id: "hdr-c1",
        type: "paragraph",
        parentId: "hdr-root",
        nextSiblingId: "hdr-c2",
        inlineContent: inlineContent([text("alpha")]),
      }),
      buildBlock({
        id: "hdr-c2",
        type: "paragraph",
        parentId: "hdr-root",
        prevSiblingId: "hdr-c1",
        inlineContent: inlineContent([text("beta")]),
      }),
    ],
  });
}

/**
 * A document with TWO sibling containers (sections) so we can build a span
 * whose endpoints resolve to DIFFERENT parents while staying in the SAME
 * (main) context — the cross-parent (not cross-context) refusal case.
 */
function buildStateWithTwoSections(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
      buildBlock({
        id: "s1",
        type: "section",
        parentId: "doc",
        nextSiblingId: "s2",
        firstChildId: "a",
        lastChildId: "a",
      }),
      buildBlock({
        id: "a",
        type: "paragraph",
        parentId: "s1",
        inlineContent: inlineContent([text("aaa")]),
      }),
      buildBlock({
        id: "s2",
        type: "section",
        parentId: "doc",
        prevSiblingId: "s1",
        firstChildId: "b",
        lastChildId: "b",
      }),
      buildBlock({
        id: "b",
        type: "paragraph",
        parentId: "s2",
        inlineContent: inlineContent([text("bbb")]),
      }),
    ],
  });
}

describe("isCrossContextSelection", () => {
  it("returns true for a main-body ↔ header-body span", () => {
    const state = buildStateWithHeaderBody();
    const span = createSpan(createPosition(HDR_P1, 2), createPosition(BODY_P1, 3));
    expect(isCrossContextSelection(state, span)).toBe(true);
  });

  it("is order-independent (header focus, body anchor)", () => {
    const state = buildStateWithHeaderBody();
    const span = createSpan(createPosition(BODY_P1, 3), createPosition(HDR_P1, 2));
    expect(isCrossContextSelection(state, span)).toBe(true);
  });

  it("returns false for a same-context cross-block main-body span", () => {
    const state = buildStateWithHeaderBody();
    const span = createSpan(createPosition(BODY_P1, 5), createPosition(BODY_P2, 4));
    expect(isCrossContextSelection(state, span)).toBe(false);
  });

  it("returns false for a same-context span wholly within one block", () => {
    const state = buildStateWithHeaderBody();
    const span = createSpan(createPosition(BODY_P1, 1), createPosition(BODY_P1, 4));
    expect(isCrossContextSelection(state, span)).toBe(false);
  });

  it("returns false for a same-context cross-parent span (both in main context)", () => {
    // s1/a and s2/b have different parents but the SAME context root (doc).
    const state = buildStateWithTwoSections();
    const span = createSpan(createPosition("a" as BlockId, 1), createPosition("b" as BlockId, 1));
    expect(isCrossContextSelection(state, span)).toBe(false);
  });
});

describe("expandedSpanCollapsePoint", () => {
  it("returns spanStart for a same-block span", () => {
    const state = buildStateWithHeaderBody();
    const start = createPosition(BODY_P1, 2);
    const span = createSpan(start, createPosition(BODY_P1, 5));
    const result = expandedSpanCollapsePoint(state, span);
    expect(result).not.toBeNull();
    expect(result).toEqual(spanStart(state, span));
  });

  it("returns spanStart for a same-parent cross-block span", () => {
    const state = buildStateWithHeaderBody();
    const span = createSpan(createPosition(BODY_P1, 5), createPosition(BODY_P2, 4));
    const result = expandedSpanCollapsePoint(state, span);
    expect(result).not.toBeNull();
    expect(result).toEqual(spanStart(state, span));
  });

  it("returns the EARLIER endpoint regardless of anchor/focus order (spanStart semantics)", () => {
    const state = buildStateWithHeaderBody();
    // anchor later than focus → spanStart is the focus (doc-order earlier).
    const span = createSpan(createPosition(BODY_P2, 4), createPosition(BODY_P1, 5));
    const result = expandedSpanCollapsePoint(state, span);
    expect(result).toEqual(createPosition(BODY_P1, 5));
  });

  it("returns null for a cross-parent span (different parents → deleteRange would throw)", () => {
    const state = buildStateWithTwoSections();
    const span = createSpan(createPosition("a" as BlockId, 1), createPosition("b" as BlockId, 1));
    expect(expandedSpanCollapsePoint(state, span)).toBeNull();
  });

  it("returns null when a block does not resolve (anchor endpoint missing)", () => {
    const state = buildStateWithHeaderBody();
    const span = createSpan(
      createPosition("nonexistent" as BlockId, 0),
      createPosition(BODY_P1, 3),
    );
    expect(expandedSpanCollapsePoint(state, span)).toBeNull();
  });

  it("returns null when a block does not resolve (focus endpoint missing)", () => {
    const state = buildStateWithHeaderBody();
    const span = createSpan(
      createPosition(BODY_P1, 3),
      createPosition("nonexistent" as BlockId, 0),
    );
    expect(expandedSpanCollapsePoint(state, span)).toBeNull();
  });
});
