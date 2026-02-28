/** Immutable node in the state tree. */
export interface StateNode {
  readonly id: string;
  readonly type: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly children: readonly StateNode[];
}
