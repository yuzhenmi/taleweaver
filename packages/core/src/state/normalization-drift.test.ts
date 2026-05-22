/**
 * T19 — Property-based drift test for the two parallel normalization
 * codepaths:
 *   - `mergeAdjacentTextItems` (JS-side; rebuilds a fresh array)
 *   - `mergeAdjacentSameAttrsTextItems` (Y-side; mutates a Y.Array in place
 *      and preserves Y.Text identity for non-converging items)
 *
 * Both must uphold the same two normalization invariants on a block's
 * `items[]`:
 *   (a) no two adjacent text items with equal attrs;
 *   (b) no zero-length text items.
 *
 * This test feeds ~100 randomized item streams (deterministic seed) through
 * both normalizers and asserts the final JS-shape outputs are equivalent.
 * The randomized inputs are biased toward exercising the merge cases that
 * matter:
 *   - empty text items as bridges between same-attrs neighbors
 *   - long runs of same-attrs text
 *   - embeds as barriers between same-attrs text runs
 *
 * Drift insurance: if either normalizer drifts (e.g. one stops dropping
 * empty items, or one stops merging across an empty bridge), this test
 * will surface the divergence against random inputs.
 */

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { mergeAdjacentTextItems, type InlineItem } from "./inline-content";
import { mergeAdjacentSameAttrsTextItems, yMapAsObject } from "./y-utils";
import { buildYInlineItem } from "./y-block";

// Deterministic seeded PRNG (mulberry32). Same seed → same sequence → no
// flaky CI. Avoids a `fast-check` dependency for one test.
function mulberry32(seed: number): () => number {
  let state = seed;
  return function () {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small pool of equivalent attr bags. Picking from a small pool (vs random
// keys) makes "same attrs" likely, so the merge path is actually exercised.
const ATTR_POOL: ReadonlyArray<Readonly<Record<string, unknown>>> = [
  {},
  { bold: true },
  { italic: true },
  { bold: true, italic: true },
  { link: "https://example.com" },
];

const EMBED_POOL: ReadonlyArray<string> = ["image", "mention", "hard-break"];

// Text content fragments. Index 0 is empty — included so the T15 "drop
// empty + merge across empty bridge" behavior is exercised by random
// inputs.
const TEXT_POOL: ReadonlyArray<string> = ["", "a", "bc", "xyz"];

function pickIndex(rng: () => number, length: number): number {
  return Math.floor(rng() * length);
}

function randomItem(rng: () => number): InlineItem {
  // 50/50 text vs embed. Biased a bit further toward text in practice
  // because we want runs of same-attrs text to form.
  const isText = rng() < 0.7;
  if (isText) {
    return {
      kind: "text",
      text: TEXT_POOL[pickIndex(rng, TEXT_POOL.length)],
      attrs: ATTR_POOL[pickIndex(rng, ATTR_POOL.length)],
    };
  }
  return {
    kind: "embed",
    embedType: EMBED_POOL[pickIndex(rng, EMBED_POOL.length)],
    attrs: ATTR_POOL[pickIndex(rng, ATTR_POOL.length)],
    properties: {},
  };
}

function generateInput(rng: () => number, length: number): InlineItem[] {
  return Array.from({ length }, () => randomItem(rng));
}

/**
 * Read a Y.Array of inline-item Y.Maps back into the plain JS InlineItem
 * shape that `mergeAdjacentTextItems` returns. Mirrors the structure that
 * snapshot.ts produces for downstream consumers.
 */
function yArrayToJS(yItems: Y.Array<Y.Map<unknown>>): InlineItem[] {
  const out: InlineItem[] = [];
  for (let i = 0; i < yItems.length; i++) {
    const yItem = yItems.get(i);
    const kind = yItem.get("kind") as "text" | "embed";
    if (kind === "text") {
      out.push({
        kind: "text",
        text: (yItem.get("text") as Y.Text).toString(),
        attrs: yMapAsObject(yItem.get("attrs") as Y.Map<unknown>),
      });
    } else {
      out.push({
        kind: "embed",
        embedType: yItem.get("embedType") as string,
        attrs: yMapAsObject(yItem.get("attrs") as Y.Map<unknown>),
        properties: yMapAsObject(yItem.get("properties") as Y.Map<unknown>),
      });
    }
  }
  return out;
}

/**
 * Normalize a JS InlineItem to a plain-object shape suitable for
 * `toEqual` comparison. The JS-side normalizer freezes text items
 * (Object.freeze), and original embed items may carry a frozen-or-not
 * `properties` reference; structural equality via `toEqual` ignores the
 * frozen flag, so a direct comparison works. We still re-shape here so
 * unrelated keys (none today, but a forward-compat guard) can't slip
 * through.
 */
function shapeOf(item: InlineItem): Record<string, unknown> {
  if (item.kind === "text") {
    return { kind: "text", text: item.text, attrs: { ...item.attrs } };
  }
  return {
    kind: "embed",
    embedType: item.embedType,
    attrs: { ...item.attrs },
    properties: { ...item.properties },
  };
}

describe("normalization drift (T19)", () => {
  it("JS and Y normalizers produce equivalent shapes for randomized inputs", () => {
    // Deterministic seed — keeps CI green and bug-reproducible.
    const rng = mulberry32(0xcafebabe);
    const ITERATIONS = 100;
    // Track a few invariants across the whole run to assert the input
    // generator actually exercises the merge paths (otherwise the test
    // would silently devolve into "all-distinct attrs, never merges").
    let sawEmptyTextInput = false;
    let sawAdjacentSameAttrsRun = false;
    let sawMergeOccurred = false;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const length = Math.floor(rng() * 9) + 2; // 2..10 items (≥2 so pairs can form)
      const input = generateInput(rng, length);

      // Coverage observations on the generated input.
      for (let i = 0; i < input.length; i++) {
        const a = input[i];
        if (a.kind === "text" && a.text.length === 0) sawEmptyTextInput = true;
        if (i + 1 < input.length) {
          const b = input[i + 1];
          if (
            a.kind === "text" &&
            b.kind === "text" &&
            JSON.stringify(a.attrs) === JSON.stringify(b.attrs)
          ) {
            sawAdjacentSameAttrsRun = true;
          }
        }
      }

      // JS side: returns a fresh array.
      const jsResult = mergeAdjacentTextItems(input);

      // Y side: build a Y.Array from the input, then mutate in place.
      const doc = new Y.Doc();
      const yArr = doc.getArray<Y.Map<unknown>>("test");
      doc.transact(() => {
        for (const item of input) {
          yArr.push([buildYInlineItem(item)]);
        }
      });
      doc.transact(() => {
        mergeAdjacentSameAttrsTextItems(yArr);
      });
      const yResult = yArrayToJS(yArr);

      if (jsResult.length < input.length) sawMergeOccurred = true;

      // Final-shape comparison: same length, same items in same order,
      // same attrs / text / embed properties.
      const jsShapes = jsResult.map(shapeOf);
      const yShapes = yResult.map(shapeOf);

      // Per-iteration assertion. If any iteration drifts, the failure
      // message shows the input and both outputs, which is exactly what
      // a debugger needs.
      expect(yShapes, `iteration ${iter}: input=${JSON.stringify(input)}`).toEqual(
        jsShapes,
      );

      // Invariant cross-checks: post-normalization, neither side should
      // have empty text items or adjacent same-attrs text pairs.
      for (let i = 0; i < jsResult.length; i++) {
        const cur = jsResult[i];
        if (cur.kind === "text") {
          expect(cur.text.length, `iteration ${iter}: empty text survived JS-side`).toBeGreaterThan(0);
        }
        if (i + 1 < jsResult.length) {
          const next = jsResult[i + 1];
          if (cur.kind === "text" && next.kind === "text") {
            expect(
              JSON.stringify(cur.attrs) === JSON.stringify(next.attrs),
              `iteration ${iter}: adjacent same-attrs text survived JS-side`,
            ).toBe(false);
          }
        }
      }
    }

    // Generator-coverage assertions: if these ever fail, the random
    // sampling has become too narrow and the test would no longer
    // exercise the drift surfaces it's supposed to.
    expect(sawEmptyTextInput, "generator never produced an empty text item").toBe(true);
    expect(
      sawAdjacentSameAttrsRun,
      "generator never produced an adjacent same-attrs text pair",
    ).toBe(true);
    expect(sawMergeOccurred, "no iteration ever triggered a merge").toBe(true);
  });
});
