import type { RenderNode, ElementBox, TextBox } from "../render/render-node";
import type { ComputedStyle } from "../styles";
import type { ContentPart, ContentValue, CounterAction } from "../styles/style";
import { PROPERTY_META } from "../styles";
import { composeComputed } from "./compose";
import { flattenLengths } from "./flatten-lengths";
import {
  createCounterScope,
  applyResets,
  applyIncrements,
  resolveCounter,
  resolveCounters,
  restore,
  type CounterScope,
} from "./counter-scope";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Walk the render tree and produce a new tree where every node carries
 * a populated `computedStyle`. The original tree is not mutated.
 *
 * Each `cascadePass` invocation seeds a FRESH `CounterScope` (CSS counters do
 * not cross context-root boundaries — the main body, each header/footer template
 * body, and each footnote body cascade via their own `cascadePass` call, so
 * counters in one never leak into another; spec §7 / M4).
 */
export function cascadePass(root: RenderNode): RenderNode {
  const t = markStart("cascadePass");
  try {
    return cascadeNode(root, null, createCounterScope()).node;
  } finally {
    markEnd("cascadePass", t);
  }
}

/**
 * Cascade `node` against `parentComputed` and the document-order counter
 * `scope`, returning the cascaded node AND the scope to thread to `node`'s
 * FOLLOWING siblings.
 *
 * Counter visibility (CSS §12.4.1) is implemented with the CHILD-BRACKET
 * discipline (spec §2 / counter-scope.ts): the node applies its OWN resets +
 * increments (leaving its own resets PUSHED on return so following siblings see
 * them), resolves its `content` counters against that post-increment scope, then
 * brackets only its CHILDREN — saving marks before recursing left-to-right and
 * restoring them after, so a child's resets are visible to that child's
 * descendants and following siblings but not to its parent's later siblings.
 */
function cascadeNode(
  node: RenderNode,
  parentComputed: ComputedStyle | null,
  scopeIn: CounterScope,
): { readonly node: RenderNode; readonly scope: CounterScope } {
  // 1. Compose computed style from specified + parent + initial
  const baseComputed = composeComputed(node.style, parentComputed);
  // 2. Flatten length values using own fontSize
  const flattened = flattenLengths(baseComputed);

  // Text nodes carry no counter inputs and have no children: the scope passes
  // through unchanged to their following siblings.
  if (node.type === "text") {
    const out: TextBox = {
      ...node,
      computedStyle: Object.freeze(flattened),
    };
    return { node: Object.freeze(out), scope: scopeIn };
  }

  // 3a. This element's OWN counter-reset (pushed; NOT popped here — stays visible
  //     to following siblings) then counter-increment (§12.4.2 reset-before-incr).
  const { scope: afterReset } = applyResets(scopeIn, flattened.counterReset);
  const scopeHere = applyIncrements(afterReset, flattened.counterIncrement);

  // 3b. Resolve this element's `content` counter()/counters() against the scope
  //     as seen AT this element (post reset+increment, spec §2/§3). Non-counter
  //     content (keywords, or arrays with no counter parts) is returned as-is —
  //     a pure no-op for documents with no counters.
  const computed = resolveContentInComputed(flattened, scopeHere);

  // 4. Bracket this element's CHILDREN: save marks, recurse left-to-right
  //    threading the scope, then restore — popping only what descendants pushed.
  const { marks: childMarks } = applyResets(scopeHere, []);
  let childScope = scopeHere;
  const newChildren = node.children.map((c) => {
    const result = cascadeNode(c, computed, childScope);
    childScope = result.scope;
    return result.node;
  });
  const scopeOut = restore(childScope, childMarks);

  const out: ElementBox = {
    ...node,
    computedStyle: Object.freeze(computed),
    children: Object.freeze(newChildren),
  };
  // Return scopeOut: child resets popped, this element's OWN resets still pushed
  // (visible to its following siblings; the PARENT pops them via its bracket).
  return { node: Object.freeze(out), scope: scopeOut };
}

/**
 * Resolve `counter()`/`counters()` parts in `computed.content` against `scope`,
 * replacing each with a `string` part carrying its formatted value (string parts
 * pass through verbatim). Returns the same ComputedStyle reference when `content`
 * has nothing to resolve (a keyword, or an array with no counter parts) so the
 * common no-counter path allocates nothing extra and stays reuse-stable.
 */
function resolveContentInComputed(
  computed: ComputedStyle,
  scope: CounterScope,
): ComputedStyle {
  const content = computed.content;
  if (typeof content === "string") {
    return computed; // "normal" / "none" — no counters to resolve.
  }
  let hasCounterPart = false;
  for (const part of content) {
    if (part.kind === "counter" || part.kind === "counters") {
      hasCounterPart = true;
      break;
    }
  }
  if (!hasCounterPart) {
    return computed; // string-only content — order-independent, nothing to do.
  }
  const resolved: ContentValue = content.map((part) => resolveContentPart(part, scope));
  return { ...computed, content: resolved };
}

/** Resolve a single `content` part against `scope`; counters → a `string` part. */
function resolveContentPart(part: ContentPart, scope: CounterScope): ContentPart {
  switch (part.kind) {
    case "string":
      return part;
    case "counter":
      return { kind: "string", value: resolveCounter(scope, part.name, part.style) };
    case "counters":
      return {
        kind: "string",
        value: resolveCounters(scope, part.name, part.sep, part.style),
      };
    default: {
      const _exhaustive: never = part;
      return _exhaustive;
    }
  }
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

/** By-value equality for `counterReset` / `counterIncrement` arrays-of-objects. */
function counterActionsEqual(
  a: readonly CounterAction[],
  b: readonly CounterAction[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x.name !== y.name || x.value !== y.value) return false;
  }
  return true;
}

/** By-value equality for two `ContentPart`s (discriminated on `kind`). */
function contentPartsEqual(a: ContentPart, b: ContentPart): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "string":
      return a.value === (b as { value: string }).value;
    case "counter":
      return (
        a.name === (b as { name: string }).name &&
        a.style === (b as { style: string }).style
      );
    case "counters": {
      const bb = b as { name: string; sep: string; style: string };
      return a.name === bb.name && a.sep === bb.sep && a.style === bb.style;
    }
    default: {
      const _exhaustive: never = a;
      return _exhaustive;
    }
  }
}

/** By-value equality for two `content` values ("normal"/"none"/ContentPart[]). */
function contentValuesEqual(
  a: ComputedStyle["content"],
  b: ComputedStyle["content"],
): boolean {
  if (a === b) return true;
  // One is a keyword, the other an array (or two different keywords) → unequal.
  if (typeof a === "string" || typeof b === "string") return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (!contentPartsEqual(x, y)) return false;
  }
  return true;
}

/** Shallow structural equality for ComputedStyle (all values are primitives or simple objects). */
export function computedStylesEqual(a: ComputedStyle, b: ComputedStyle): boolean {
  if (a === b) return true;
  for (const k of COMPUTED_STYLE_KEYS) {
    const av = a[k];
    const bv = b[k];
    if (av === bv) continue;

    // Generated-content + counter arrays hold OBJECT elements, so the generic
    // array branch below (which compares elements with `!==`) would wrongly
    // report two structurally-equal-but-distinct arrays as unequal. Compare them
    // by value, keyed on the property name.
    if (k === "counterReset" || k === "counterIncrement") {
      if (counterActionsEqual(a[k], b[k])) continue;
      return false;
    }
    if (k === "content") {
      if (contentValuesEqual(a.content, b.content)) continue;
      return false;
    }

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
