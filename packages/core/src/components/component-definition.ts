import type { StateNode } from "../state/state-node-legacy";
import type { RenderNode } from "../render/render-node-v2";

/**
 * A component render function.
 * Pure function of state + already-rendered children → render node.
 */
export type ComponentRenderFn = (
  node: StateNode,
  renderedChildren: readonly RenderNode[],
) => RenderNode;

/** A component definition — type identifier plus a render function. */
export interface ComponentDefinition {
  readonly type: string;
  readonly render: ComponentRenderFn;
}
