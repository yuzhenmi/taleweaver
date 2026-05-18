import type { Style } from "../styles";

/** Immutable node in the state tree. */
export interface StateNode {
  readonly id: string;
  readonly type: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly style: Readonly<Style>;
  readonly children: readonly StateNode[];
}
