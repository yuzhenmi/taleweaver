/**
 * FN-6.4 slice 2 — `RenderOptions.footnoteNumbersOverride`.
 *
 * The layout pass discovers each footnote anchor's page only AFTER pagination,
 * so `restart-per-page` numbers cannot be derived from state at render time
 * (render falls back to continuous via `effectiveRenderPolicy`). FN-6.4's
 * second pass re-renders the affected markers with the layout-derived per-page
 * numbers, injected through this override.
 *
 * When `footnoteNumbersOverride` is supplied, render uses it as the authoritative
 * numbering map for BOTH the inline call markers (`expandInlineItems`) and the
 * footnote-body leading markers (`makeRenderContext` → `footnoteNumber`),
 * skipping the policy-derived computation entirely. When absent, behavior is
 * unchanged (these tests assert both directions).
 */
import { describe, it, expect } from "vitest";
import { render } from "./render";
import type { RenderOutput } from "./render";
import type { RenderNode } from "./render-node";
import {
  config,
  componentRegistry,
  attrRegistry,
  createInitialEditorState,
  reduceEditor,
} from "../editor/actions/test-helpers";
import { collectFootnoteAnchors, type FootnoteNumber } from "../footnotes";
import { FOOTNOTE_ANCHOR_EMBED_TYPE } from "../state";
import type { State, BlockId } from "../state";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** Build a one-paragraph doc carrying a single footnote; return its ids. */
function docWithOneFootnote(): {
  state: State;
  contentBlockId: BlockId;
  hostBlockId: BlockId;
} {
  let editor = createInitialEditorState(config);
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" }, config);
  editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
  const anchors = collectFootnoteAnchors(editor.state);
  if (anchors.length !== 1) {
    throw new Error(`expected exactly one footnote anchor, got ${anchors.length}`);
  }
  return {
    state: editor.state,
    contentBlockId: nth(anchors, 0, "anchor").contentBlockId,
    hostBlockId: nth(anchors, 0, "anchor").blockId,
  };
}

/**
 * Find the call-marker text for a footnote anchor in the main render tree: the
 * inline marker is an `element` whose metadata.embedType is the footnote-anchor
 * type; its single child carries the number `TextBox`.
 */
function callMarkerText(root: RenderNode, contentBlockId: BlockId): string | undefined {
  let found: string | undefined;
  const walk = (node: RenderNode): void => {
    if (node.type === "element") {
      if (
        node.metadata?.embedType === FOOTNOTE_ANCHOR_EMBED_TYPE &&
        node.metadata?.contentBlockId === contentBlockId
      ) {
        // The marker's only inline child is the number TextBox.
        for (const child of node.children) {
          if (child.type === "text") found = child.text;
        }
      }
      for (const child of node.children) walk(child);
    }
  };
  walk(root);
  return found;
}

/** Read the body-root markerText for a footnote body (its leading number). */
function bodyMarkerText(out: RenderOutput, contentBlockId: BlockId): string | undefined {
  const body = out.embedContents.get(contentBlockId);
  if (body === undefined || body.type !== "element") return undefined;
  const mt = body.style.markerText;
  return typeof mt === "string" ? mt : undefined;
}

const FIVE: FootnoteNumber = { value: 5, formatted: "5" };

describe("FN-6.4 — render footnoteNumbersOverride (call marker + body marker)", () => {
  it("call marker uses the override number, not the policy-derived one", () => {
    const { state, contentBlockId } = docWithOneFootnote();

    // Default (no override): continuous → bare "1" on the call marker.
    const def = render(state, componentRegistry, attrRegistry);
    expect(callMarkerText(def.root, contentBlockId)).toBe("1");

    // With override → "5".
    const override = new Map<BlockId, FootnoteNumber>([[contentBlockId, FIVE]]);
    const out = render(state, componentRegistry, attrRegistry, {
      footnoteNumbersOverride: override,
    });
    expect(callMarkerText(out.root, contentBlockId)).toBe("5");
  });

  it("body leading marker uses the override number too", () => {
    const { state, contentBlockId } = docWithOneFootnote();

    const def = render(state, componentRegistry, attrRegistry);
    expect(bodyMarkerText(def, contentBlockId)).toBe("1.");

    const override = new Map<BlockId, FootnoteNumber>([[contentBlockId, FIVE]]);
    const out = render(state, componentRegistry, attrRegistry, {
      footnoteNumbersOverride: override,
    });
    // The body marker adds the list-style "." to the override's bare number.
    expect(bodyMarkerText(out, contentBlockId)).toBe("5.");
  });

  it("the override map is cached on RenderOutput.footnoteNumbers", () => {
    const { state, contentBlockId } = docWithOneFootnote();
    const override = new Map<BlockId, FootnoteNumber>([[contentBlockId, FIVE]]);
    const out = render(state, componentRegistry, attrRegistry, {
      footnoteNumbersOverride: override,
    });
    expect(out.footnoteNumbers.get(contentBlockId)?.formatted).toBe("5");
  });

  it("override flows through the INCREMENTAL path and overrides the reused cache", () => {
    const { state, contentBlockId, hostBlockId } = docWithOneFootnote();
    // Prior cycle: continuous (no override).
    const prev = render(state, componentRegistry, attrRegistry);
    expect(prev.footnoteNumbers.get(contentBlockId)?.formatted).toBe("1");

    // Incremental cycle with the changed-marker blocks dirtied (the HOST block
    // for the call marker, the body root for the body marker — exactly the set
    // FN-6.4's second pass invalidates) AND an override supplied. The override
    // must win over the reused prev.footnoteNumbers cache and re-render both
    // markers with "5".
    const override = new Map<BlockId, FootnoteNumber>([[contentBlockId, FIVE]]);
    const out = render(state, componentRegistry, attrRegistry, {
      prev,
      prevState: state,
      dirtyIds: new Set<BlockId>([hostBlockId, contentBlockId]),
      footnoteNumbersOverride: override,
    });
    expect(out.footnoteNumbers.get(contentBlockId)?.formatted).toBe("5");
    expect(callMarkerText(out.root, contentBlockId)).toBe("5");
    // Body marker shares the override's counter value but adds the "." suffix.
    expect(bodyMarkerText(out, contentBlockId)).toBe("5.");
  });

  it("no override → behavior unchanged (continuous default)", () => {
    const { state, contentBlockId } = docWithOneFootnote();
    const out = render(state, componentRegistry, attrRegistry);
    expect(out.footnoteNumbers.get(contentBlockId)?.formatted).toBe("1");
    expect(callMarkerText(out.root, contentBlockId)).toBe("1");
  });
});
