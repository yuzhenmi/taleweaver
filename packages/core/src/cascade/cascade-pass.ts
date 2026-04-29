import type { RenderNode, ElementBox, TextBox } from "../render/render-node-v2";
import type { ComputedStyle } from "../styles";
import type { Length, ComputedLength, ComputedLengthOrAuto } from "../styles/length";
import { INITIAL_COMPUTED_STYLE } from "../styles/property-meta";
import { composeComputed } from "./compose";
import { resolveLength } from "./resolve-length";

/**
 * Walk the render tree and produce a new tree where every node carries
 * a populated `computedStyle`. The original tree is not mutated.
 */
export function cascadePass(root: RenderNode): RenderNode {
  return cascadeNode(root, null);
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

/** Flatten em values to px using own fontSize. */
function flattenLengths(cs: ComputedStyle): ComputedStyle {
  // 1. Resolve fontSize first — needed by all subsequent em-resolutions.
  const fontSize = resolveFontSize(cs);

  // 2. Build a new computed style with em-resolved lengths.
  return {
    ...cs,
    fontSize,
    inlineSize:    flattenLengthOrAuto(cs.inlineSize, fontSize),
    blockSize:     flattenLengthOrAuto(cs.blockSize, fontSize),
    minInlineSize: flattenLength(cs.minInlineSize, fontSize),
    minBlockSize:  flattenLength(cs.minBlockSize, fontSize),
    maxInlineSize: flattenLengthOrNone(cs.maxInlineSize, fontSize),
    maxBlockSize:  flattenLengthOrNone(cs.maxBlockSize, fontSize),

    marginBlockStart:  flattenLengthOrAuto(cs.marginBlockStart, fontSize),
    marginBlockEnd:    flattenLengthOrAuto(cs.marginBlockEnd, fontSize),
    marginInlineStart: flattenLengthOrAuto(cs.marginInlineStart, fontSize),
    marginInlineEnd:   flattenLengthOrAuto(cs.marginInlineEnd, fontSize),

    paddingBlockStart:  flattenLength(cs.paddingBlockStart, fontSize),
    paddingBlockEnd:    flattenLength(cs.paddingBlockEnd, fontSize),
    paddingInlineStart: flattenLength(cs.paddingInlineStart, fontSize),
    paddingInlineEnd:   flattenLength(cs.paddingInlineEnd, fontSize),

    lineHeight: flattenLineHeight(cs.lineHeight, fontSize),
  };
}

function flattenLength(v: ComputedLength | Length, fontSize: number): ComputedLength {
  if (typeof v === "number") return v;
  if (v.unit === "percent") return v;
  if (v.unit === "px") return v.value;
  // unit === "em" — should not appear in ComputedStyle inputs, but handle defensively
  return resolveLength(v as Length, fontSize);
}

function flattenLengthOrAuto(v: ComputedLengthOrAuto | Length | "auto", fontSize: number): ComputedLengthOrAuto {
  if (v === "auto") return "auto";
  return flattenLength(v, fontSize);
}

function flattenLengthOrNone(v: ComputedLength | Length | "none", fontSize: number): ComputedLength | "none" {
  if (v === "none") return "none";
  return flattenLength(v, fontSize);
}

function flattenLineHeight(v: number | ComputedLength | Length, fontSize: number): number | ComputedLength {
  if (typeof v === "number") return v;
  return flattenLength(v, fontSize);
}

function resolveFontSize(cs: ComputedStyle): number {
  const v: unknown = cs.fontSize;

  if (typeof v === "number") return v;

  // Composition may produce Length object values before flattening.
  // Type-guard the shape to safely access properties without unsafe casts.
  if (typeof v === "object" && v !== null && "unit" in v) {
    const lv = v as { unit: string; value: number };
    if (lv.unit === "px") return lv.value;
    if (lv.unit === "em") {
      // Document root case: no parent fontSize, use the initial.
      return lv.value * INITIAL_COMPUTED_STYLE.fontSize;
    }
  }

  return INITIAL_COMPUTED_STYLE.fontSize;
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
  return cascadeNodeIncremental(newRoot, oldRoot, oldCascadedRoot, null, null);
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

/** Shallow structural equality for ComputedStyle (all values are primitives or simple objects). */
function computedStylesEqual(a: ComputedStyle, b: ComputedStyle): boolean {
  const aRecord = a as unknown as Record<string, unknown>;
  const bRecord = b as unknown as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) return false;
  for (const key of aKeys) {
    const av = aRecord[key];
    const bv = bRecord[key];
    if (av !== bv) {
      // Handle LengthValue objects ({ unit, value })
      if (
        typeof av === "object" && av !== null &&
        typeof bv === "object" && bv !== null
      ) {
        const ao = av as Record<string, unknown>;
        const bo = bv as Record<string, unknown>;
        if (ao["unit"] !== bo["unit"] || ao["value"] !== bo["value"]) return false;
      } else {
        return false;
      }
    }
  }
  return true;
}
