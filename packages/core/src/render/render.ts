import type { StateNode } from "../state/state-node";
import type { RenderNode } from "./render-node";
import type { ComponentRegistry } from "../components/component-registry";

/**
 * Render the full state tree to a render tree.
 * Traverses bottom-up: children are rendered first, then passed to the parent's render function.
 */
export function renderTree(
  state: StateNode,
  registry: ComponentRegistry,
): RenderNode {
  const def = registry.get(state.type);
  if (!def) {
    throw new Error(`No render function registered for type "${state.type}"`);
  }

  const renderedChildren = state.children.map((child) =>
    renderTree(child, registry),
  );

  return def.render(state, renderedChildren);
}

/**
 * Incremental render: only re-render branches where the state node reference changed.
 * Uses key-based (id) matching to handle insertions and removals without
 * re-rendering unchanged children that shifted position.
 */
export function renderTreeIncremental(
  newState: StateNode,
  oldState: StateNode,
  oldRenderTree: RenderNode,
  registry: ComponentRegistry,
): RenderNode {
  if (newState === oldState) {
    return oldRenderTree;
  }

  const def = registry.get(newState.type);
  if (!def) {
    throw new Error(`No render function registered for type "${newState.type}"`);
  }

  // Build lookup maps from old state children by id
  const oldStateById = new Map<string, StateNode>();
  const oldRenderById = new Map<string, RenderNode>();
  for (let i = 0; i < oldState.children.length; i++) {
    const oldChild = oldState.children[i];
    oldStateById.set(oldChild.id, oldChild);
    if (i < oldRenderTree.children.length) {
      oldRenderById.set(oldChild.id, oldRenderTree.children[i]);
    }
  }

  // Match new children by id
  const renderedChildren = newState.children.map((child) => {
    const oldChild = oldStateById.get(child.id);
    const oldRendered = oldRenderById.get(child.id);

    if (oldChild && oldRendered && child === oldChild) {
      // Same reference — reuse render node
      return oldRendered;
    }
    if (oldChild && oldRendered && child.type === oldChild.type) {
      // Same id and type but different reference — incremental render
      return renderTreeIncremental(child, oldChild, oldRendered, registry);
    }
    // New child or type changed — full render
    return renderTree(child, registry);
  });

  return def.render(newState, renderedChildren);
}
