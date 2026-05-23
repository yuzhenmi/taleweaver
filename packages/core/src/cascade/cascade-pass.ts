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

/** Shallow structural equality for ComputedStyle (all values are primitives or simple objects). */
export function computedStylesEqual(a: ComputedStyle, b: ComputedStyle): boolean {
  if (a === b) return true;
  for (const k of COMPUTED_STYLE_KEYS) {
    const av = a[k];
    const bv = b[k];
    if (av === bv) continue;

    // For complex values, compare structurally.
    if (
      typeof av === "object" && av !== null &&
      typeof bv === "object" && bv !== null
    ) {
      // Length objects: { unit, value } — compare both fields.
      if (
        "unit" in av && "value" in av &&
        "unit" in bv && "value" in bv &&
        (av as { unit: string; value: number }).unit === (bv as { unit: string; value: number }).unit &&
        (av as { unit: string; value: number }).value === (bv as { unit: string; value: number }).value
      ) {
        continue;
      }
      // Arrays (e.g., fontFeatureSettings): compare shallowly.
      if (Array.isArray(av) && Array.isArray(bv)) {
        if (av.length !== bv.length) return false;
        let arrEqual = true;
        for (let i = 0; i < av.length; i++) {
          if (av[i] !== bv[i]) { arrEqual = false; break; }
        }
        if (arrEqual) continue;
      }
      return false;
    }
    return false;
  }
  return true;
}
