import type { RenderNode, ElementBox, TextBox } from "../render/render-node-v2";
import type { ComputedStyle, LengthOrAuto } from "../styles";
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
  const fontSize = typeof cs.fontSize === "number" ? cs.fontSize :
    typeof cs.fontSize === "object" && cs.fontSize.unit === "px" ? cs.fontSize.value :
    typeof cs.fontSize === "object" && cs.fontSize.unit === "em" ? cs.fontSize.value * 16 :  // root fallback
    16;

  // Length-typed properties to flatten
  const out: Record<string, unknown> = { ...cs };
  out.fontSize = fontSize;

  for (const key of LENGTH_PROPERTIES) {
    const v = (cs as Record<string, unknown>)[key];
    if (v !== undefined) {
      out[key] = resolveLength(v as LengthOrAuto | "none", fontSize);
    }
  }
  return out as ComputedStyle;
}

const LENGTH_PROPERTIES = [
  "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
] as const;
