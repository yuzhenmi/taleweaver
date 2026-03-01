/**
 * Closed set of style properties configurable on state nodes.
 * These are the styles users can apply through the editor (bold, italic, etc.).
 * Render-only styles like padding and margin are set by component implementations
 * and do not appear here.
 */
export interface NodeStyles {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: string;
  readonly fontStyle?: string;
  readonly textDecoration?: string;
  readonly lineHeight?: number;
}

/** Immutable node in the state tree. */
export interface StateNode {
  readonly id: string;
  readonly type: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly styles: Readonly<NodeStyles>;
  readonly children: readonly StateNode[];
}
