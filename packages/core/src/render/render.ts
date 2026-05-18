import type { StateNode } from "../state/state-node-legacy";
import type { RenderNode } from "./render-node";
import type { ComponentRegistry } from "../components/component-registry-legacy";

/** Render the state tree to a render tree, bottom-up. */
export function renderTree(state: StateNode, registry: ComponentRegistry): RenderNode {
  const def = registry.get(state.type);
  if (!def) throw new Error(`No render function for type "${state.type}"`);
  const children = state.children.map((c) => renderTree(c, registry));
  return def.render(state, children);
}

/**
 * Incremental render that preserves reference equality on unchanged subtrees.
 *
 * State-tree edits (insertText, etc.) preserve StateNode references for nodes
 * not on the change path — `updateAtPath` rebuilds only the path and shares
 * sibling references. This function exploits that: when `state === oldState`
 * at any level, the corresponding `oldRender` subtree is returned as-is.
 *
 * Reference equality flows downstream: the cascade short-circuit
 * (`newNode === oldNode`) fires for unchanged subtrees, and layout reuse
 * (`isLayoutBoxReusable`) checks render-node identity. Without this function,
 * every render pass produced fresh objects and downstream caches always missed.
 */
export function renderTreeIncremental(
  state: StateNode,
  oldState: StateNode | null,
  oldRender: RenderNode | null,
  registry: ComponentRegistry,
): RenderNode {
  // Whole-subtree short-circuit: if state hasn't changed at this level, the
  // entire render subtree is unchanged. Return the same reference.
  if (oldState !== null && oldRender !== null && state === oldState) {
    return oldRender;
  }

  // State changed at this level. Recurse into children, reusing oldRender's
  // children where the state child is reference-equal.
  const def = registry.get(state.type);
  if (!def) throw new Error(`No render function for type "${state.type}"`);

  const oldChildren = oldState?.children ?? null;
  const oldRenderChildren =
    oldRender !== null && "children" in oldRender ? oldRender.children : null;

  const children = state.children.map((c, i) => {
    const oldC = oldChildren?.[i] ?? null;
    const oldR = oldRenderChildren?.[i] ?? null;
    return renderTreeIncremental(c, oldC, oldR, registry);
  });

  return def.render(state, children);
}
