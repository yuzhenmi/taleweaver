/**
 * T19 — Property-based drift test for the THREE parallel normalization
 * codepaths:
 *   - `mergeAdjacentTextItems` (JS-side; rebuilds a fresh array)
 *   - `mergeAdjacentSameAttrsTextItems` (Y-side rebuild; mutates a Y.Array in
 *      place, preserving Y.Text identity for non-converging items, but rebuilds
 *      a converging pair into a fresh Y.Text)
 *   - `mergeAdjacentSameAttrsTextItemsInPlace` (Y-side identity-preserving twin
 *      used by the live-array appliers — a converging pair keeps the receiver's
 *      Y.Text; runs on its own integrated doc inside a transaction)
 *
 * All three must uphold the same two normalization invariants on a block's
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
import {
  mergeAdjacentSameAttrsTextItems,
  mergeAdjacentSameAttrsTextItemsInPlace,
  yMapAsObject,
} from "./y-utils";
import { buildYInlineItem } from "./y-block";
import { AttrRegistry } from "../cascade/attr-registry";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
      text: nth(TEXT_POOL, pickIndex(rng, TEXT_POOL.length), "text fragment"),
      attrs: nth(ATTR_POOL, pickIndex(rng, ATTR_POOL.length), "attr bag"),
    };
  }
  return {
    kind: "embed",
    embedType: nth(EMBED_POOL, pickIndex(rng, EMBED_POOL.length), "embed type"),
    attrs: nth(ATTR_POOL, pickIndex(rng, ATTR_POOL.length), "attr bag"),
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

/**
 * Drive both normalizers over the same randomized input, optionally
 * threading an `AttrRegistry`. Asserts the two normalizers produce
 * equivalent shapes after running, and that the two normalization
 * invariants (no empty text items; no adjacent same-attrs text under the
 * SAME equality function the normalizer was given) hold on the result.
 *
 * Hoisted so both the no-registry and registry-passed tests use the
 * exact same logic — guarantees we are testing the same surface twice
 * with the only difference being the equality function.
 */
function runDriftIterations(opts: {
  registry?: AttrRegistry;
  seed: number;
  iterations: number;
  generate: (rng: () => number, length: number) => InlineItem[];
  attrsEqualForCoverage: (a: ReadonlyAttrsRecord, b: ReadonlyAttrsRecord) => boolean;
}): { sawEmptyTextInput: boolean; sawAdjacentSameAttrsRun: boolean; sawMergeOccurred: boolean } {
  const rng = mulberry32(opts.seed);
  let sawEmptyTextInput = false;
  let sawAdjacentSameAttrsRun = false;
  let sawMergeOccurred = false;

  for (let iter = 0; iter < opts.iterations; iter++) {
    const length = Math.floor(rng() * 9) + 2;
    const input = opts.generate(rng, length);

    for (let i = 0; i < input.length; i++) {
      const a = nth(input, i, "input item");
      if (a.kind === "text" && a.text.length === 0) sawEmptyTextInput = true;
      if (i + 1 < input.length) {
        const b = nth(input, i + 1, "input item");
        if (a.kind === "text" && b.kind === "text" && opts.attrsEqualForCoverage(a.attrs, b.attrs)) {
          sawAdjacentSameAttrsRun = true;
        }
      }
    }

    const jsResult = mergeAdjacentTextItems(input, opts.registry);

    const doc = new Y.Doc();
    const yArr = doc.getArray<Y.Map<unknown>>("test");
    doc.transact(() => {
      for (const item of input) yArr.push([buildYInlineItem(item)]);
    });
    doc.transact(() => {
      mergeAdjacentSameAttrsTextItems(yArr, opts.registry);
    });
    const yResult = yArrayToJS(yArr);

    // Third arm: the identity-preserving in-place twin must produce the SAME
    // normalized read-back as the JS-side AND the Y-side rebuild (the byte-identity
    // lock the live-array appliers rely on — slice 5). It mutates a live Y.Text in
    // place (`aText.insert`), so it runs on its own integrated doc inside a tx.
    const docInPlace = new Y.Doc();
    const yArrInPlace = docInPlace.getArray<Y.Map<unknown>>("test");
    docInPlace.transact(() => {
      for (const item of input) yArrInPlace.push([buildYInlineItem(item)]);
    });
    docInPlace.transact(() => {
      mergeAdjacentSameAttrsTextItemsInPlace(yArrInPlace, opts.registry);
    });
    const yInPlaceResult = yArrayToJS(yArrInPlace);

    if (jsResult.length < input.length) sawMergeOccurred = true;

    const jsShapes = jsResult.map(shapeOf);
    const yShapes = yResult.map(shapeOf);
    const yInPlaceShapes = yInPlaceResult.map(shapeOf);

    expect(yShapes, `iteration ${iter}: input=${JSON.stringify(input)}`).toEqual(jsShapes);
    expect(
      yInPlaceShapes,
      `iteration ${iter}: in-place twin drifted from JS-side; input=${JSON.stringify(input)}`,
    ).toEqual(jsShapes);

    // Invariant cross-checks per the equality function actually used.
    for (let i = 0; i < jsResult.length; i++) {
      const cur = nth(jsResult, i, "result item");
      if (cur.kind === "text") {
        expect(cur.text.length, `iteration ${iter}: empty text survived JS-side`).toBeGreaterThan(0);
      }
      if (i + 1 < jsResult.length) {
        const next = nth(jsResult, i + 1, "result item");
        if (cur.kind === "text" && next.kind === "text") {
          expect(
            opts.attrsEqualForCoverage(cur.attrs, next.attrs),
            `iteration ${iter}: adjacent same-attrs text survived JS-side`,
          ).toBe(false);
        }
      }
    }
  }

  return { sawEmptyTextInput, sawAdjacentSameAttrsRun, sawMergeOccurred };
}

type ReadonlyAttrsRecord = Readonly<Record<string, unknown>>;

describe("normalization drift (T19)", () => {
  it("JS and Y normalizers produce equivalent shapes for randomized inputs", () => {
    const { sawEmptyTextInput, sawAdjacentSameAttrsRun, sawMergeOccurred } = runDriftIterations({
      seed: 0xcafebabe,
      iterations: 100,
      generate: generateInput,
      // Without a registry, both normalizers use deep-value equality.
      // JSON.stringify is a safe proxy for the small attr bags used here.
      attrsEqualForCoverage: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    });

    expect(sawEmptyTextInput, "generator never produced an empty text item").toBe(true);
    expect(sawAdjacentSameAttrsRun, "generator never produced an adjacent same-attrs text pair").toBe(true);
    expect(sawMergeOccurred, "no iteration ever triggered a merge").toBe(true);
  });

  // T-C: drift insurance under registry-supplied custom equals. The same
  // randomized property test must hold when both normalizers are given a
  // registry whose interpreter says two `comment` attrs with the same id
  // are equal regardless of timestamp. If JS-side and Y-side diverge on
  // how they consult the registry, this test fires.
  it("JS and Y normalizers stay equivalent under registry-supplied custom equals", () => {
    interface CommentAttr {
      readonly id: string;
      readonly timestamp: number;
    }
    function isCommentAttr(v: unknown): v is CommentAttr {
      return (
        typeof v === "object" &&
        v !== null &&
        typeof (v as { id?: unknown }).id === "string" &&
        typeof (v as { timestamp?: unknown }).timestamp === "number"
      );
    }

    const registry = new AttrRegistry();
    registry.register({
      attrKey: "comment",
      toStyle: () => ({}),
      equals: (a, b) => {
        if (!isCommentAttr(a) || !isCommentAttr(b)) return false;
        return a.id === b.id;
      },
    });

    // Generator: text items whose attrs include a `comment` whose `id`
    // is drawn from a small pool but whose `timestamp` is unique per
    // item. Without the registry, deep-equal sees timestamps differ →
    // never merges. With the registry, runs with the same comment id
    // merge — which is exactly what custom-equals interpreters are for.
    const COMMENT_IDS: ReadonlyArray<string> = ["c1", "c2", "c3"];
    let timestampCounter = 0;
    function generateCommentInput(rng: () => number, length: number): InlineItem[] {
      return Array.from({ length }, () => {
        const isText = rng() < 0.7;
        if (isText) {
          const text = nth(TEXT_POOL, Math.floor(rng() * TEXT_POOL.length), "text fragment");
          const commentId = nth(COMMENT_IDS, Math.floor(rng() * COMMENT_IDS.length), "comment id");
          const attrs: ReadonlyAttrsRecord = {
            comment: { id: commentId, timestamp: timestampCounter++ },
          };
          return { kind: "text", text, attrs };
        }
        return {
          kind: "embed",
          embedType: nth(EMBED_POOL, Math.floor(rng() * EMBED_POOL.length), "embed type"),
          attrs: {},
          properties: {},
        };
      });
    }

    // Coverage equality function matches the registry's interpreter.
    function commentIdEqual(a: ReadonlyAttrsRecord, b: ReadonlyAttrsRecord): boolean {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (const k of ka) {
        if (!(k in b)) return false;
        if (k === "comment") {
          const av = a[k];
          const bv = b[k];
          if (!isCommentAttr(av) || !isCommentAttr(bv)) return false;
          if (av.id !== bv.id) return false;
        } else {
          if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
        }
      }
      return true;
    }

    const { sawAdjacentSameAttrsRun, sawMergeOccurred } = runDriftIterations({
      registry,
      seed: 0xdeadbeef,
      iterations: 100,
      generate: generateCommentInput,
      attrsEqualForCoverage: commentIdEqual,
    });

    // Custom-equals exercise: must see same-id adjacent pairs AND merges.
    // (Empty-text coverage is not relevant here — this generator only
    // emits non-empty text items.)
    expect(
      sawAdjacentSameAttrsRun,
      "generator never produced adjacent text items with the same comment id (registry-equality view)",
    ).toBe(true);
    expect(
      sawMergeOccurred,
      "no iteration ever triggered a merge under custom-equals — equality function may be too strict",
    ).toBe(true);
  });
});
