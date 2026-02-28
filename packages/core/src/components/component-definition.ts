import type { StateNode } from "../state/state-node";
import type { RenderNode } from "../render/render-node";

/**
 * A component render function.
 * Takes a state node and its already-rendered children,
 * returns a render node (or tree of render nodes).
 */
export type ComponentRenderFn = (
  node: StateNode,
  renderedChildren: readonly RenderNode[],
) => RenderNode;

/** A component definition unifying rendering and schema constraints. */
export interface ComponentDefinition {
  readonly type: string;
  readonly render: ComponentRenderFn;
}
