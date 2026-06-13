import type { RenderNode, ElementBox, TextBox } from "../render/render-node";
import type { ComputedStyle } from "../styles";
import { PROPERTY_META } from "../styles";
import { composeComputed } from "./compose";
import { flattenLengths } from "./flatten-lengths";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Walk the render tree and produce a new tree where every node carries
 * a populated `computedStyle`. The original tree is not mutated.
 */
export function cascadePass(root: RenderNode): RenderNode {
  const t = markStart("cascadePass");
  try {
    return cascadeNode(root, null);
  } finally {
    markEnd("cascadePass", t);
  }
}

function cascadeNode(
  node: RenderNode,
  parentComputed: ComputedStyle | null,
): RenderNode {
  // 1. Compose computed style from specified + parent + initial
  const baseComputed = composeComputed(node.style, parentComputed);
  // 2. Flatten length values using own fontSize
  const computed = flattenLengths(baseComputed);

  if (node.type === "text") {
    const out: TextBox = {
      ...node,
      computedStyle: Object.freeze(computed),
    };
    return Object.freeze(out);
  }

  // ElementBox: recurse into children
  const newChildren = node.children.map((c) => cascadeNode(c, computed));
  const out: ElementBox = {
    ...node,
    computedStyle: Object.freeze(computed),
    children: Object.freeze(newChildren),
  };
  return Object.freeze(out);
}

/**
 * Incremental cascade. Reuses the old cascaded subtree when:
 *  - The new render node is reference-equal to the old render node, AND
 *  - The parent's computed style is reference-equal to the old parent's computed style.
 *
 * When parent's computedStyle changed in a way that affects inheritable properties,
 * we recompute. We don't yet check property-by-property — any parent change triggers
 * recompute. (Could optimize further by checking only inheritable props if needed.)
 */
export function cascadePassIncremental(
  newRoot: RenderNode,
  oldRoot: RenderNode | null,
  oldCascadedRoot: RenderNode | null,
): RenderNode {
  const t = markStart("cascadePassIncremental");
  try {
    return cascadeNodeIncremental(newRoot, oldRoot, oldCascadedRoot, null, null);
  } finally {
    markEnd("cascadePassIncremental", t);
  }
}

function cascadeNodeIncremental(
  newNode: RenderNode,
  oldNode: RenderNode | null,
  oldCascaded: RenderNode | null,
  parentComputed: ComputedStyle | null,
  oldParentComputed: ComputedStyle | null,
): RenderNode {
  // Short-circuit: same render-node reference AND same parent computed style.
  if (
    oldNode !== null && oldCascaded !== null &&
    newNode === oldNode && parentComputed === oldParentComputed
  ) {
    return oldCascaded;
  }

  // Recompute.
  const baseComputed = composeComputed(newNode.style, parentComputed);
  let computed = flattenLengths(baseComputed);

  // If the resulting computed style is structurally identical to the old one,
  // reuse the old reference so child short-circuits can still fire via ===.
  const oldComputed = oldCascaded?.computedStyle ?? null;
  if (oldComputed !== null && computedStylesEqual(computed, oldComputed)) {
    computed = oldComputed;
  }

  if (newNode.type === "text") {
    return Object.freeze({ ...newNode, computedStyle: Object.freeze(computed) });
  }

  // Recurse into children, matching by key.
  const oldChildren = oldNode?.type === "element" ? oldNode.children : [];
  const oldCascadedChildren = oldCascaded?.type === "element" ? oldCascaded.children : [];
  const oldByKey = new Map<string, { node: RenderNode; cascaded: RenderNode }>();
  for (let i = 0; i < oldChildren.length; i++) {
    const o = oldChildren[i];
    const oc = oldCascadedChildren[i];
    if (o !== undefined && oc !== undefined) {
      oldByKey.set(o.key, { node: o, cascaded: oc });
    }
  }

  const oldComputedForRecurse = oldCascaded?.computedStyle ?? null;
  const newChildren = newNode.children.map((child) => {
    const prev = oldByKey.get(child.key);
    return cascadeNodeIncremental(
      child,
      prev?.node ?? null,
      prev?.cascaded ?? null,
      computed,
      oldComputedForRecurse,
    );
  });

  return Object.freeze({
    ...newNode,
    computedStyle: Object.freeze(computed),
    children: Object.freeze(newChildren),
  });
}

/**
 * Derived from `PROPERTY_META` so a new ComputedStyle property added to
 * `property-meta.ts` is automatically picked up by `computedStylesEqual`.
 * Hand-maintained lists drift; a missing key here would let
 * `computedStylesEqual` silently return `true` for unequal styles, causing
 * incremental layout's reuse cache to serve stale boxes after a style change.
 */
export const COMPUTED_STYLE_KEYS: readonly (keyof ComputedStyle)[] =
  Object.keys(PROPERTY_META) as (keyof ComputedStyle)[];

/**
 * Recursive structural equality for a single ComputedStyle value. ComputedStyle
 * values are JSON-like: primitives, plain objects (`Length` `{unit,value}`,
 * `TransformOrigin` `{x,y}`, `listStyleType` `{content}`), and arrays of those
 * (`transform: TransformFn[]`, `fontFeatureSettings`). This compares them by
 * value to whatever depth they nest (Length is 1 level, TransformOrigin 2,
 * `transform` an array of 1-level structs — all finite, no cycles).
 *
 * Returning `true` only for genuinely-equal values is load-bearing: a false
 * positive lets incremental layout's reuse cache serve stale boxes after a
 * style change (see `computedStylesEqual`). A false negative only costs a
 * spurious re-cascade. This is exact, so neither happens for structural values.
 */
function styleValueEqual(av: unknown, bv: unknown): boolean {
  if (av === bv) return true;
  if (typeof av !== "object" || av === null || typeof bv !== "object" || bv === null) {
    // Distinct primitives (or object-vs-primitive) — unequal.
    return false;
  }
  const aIsArray = Array.isArray(av);
  const bIsArray = Array.isArray(bv);
  if (aIsArray !== bIsArray) return false;
  if (aIsArray && bIsArray) {
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (!styleValueEqual(av[i], bv[i])) return false;
    }
    return true;
  }
  // Plain objects: same key set, each value structurally equal. `Object.entries`
  // narrows without a cast (the lib types the element value as `any`, which flows
  // into `styleValueEqual`'s `unknown` param — no explicit assertion needed).
  const aEntries = Object.entries(av);
  const bEntries = Object.entries(bv);
  if (aEntries.length !== bEntries.length) return false;
  const bMap = new Map(bEntries);
  for (const [key, aChild] of aEntries) {
    if (!bMap.has(key)) return false;
    if (!styleValueEqual(aChild, bMap.get(key))) return false;
  }
  return true;
}

/** Structural equality for ComputedStyle, by value to full depth (see `styleValueEqual`). */
export function computedStylesEqual(a: ComputedStyle, b: ComputedStyle): boolean {
  if (a === b) return true;
  for (const k of COMPUTED_STYLE_KEYS) {
    if (!styleValueEqual(a[k], b[k])) return false;
  }
  return true;
}
