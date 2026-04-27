import type { Style } from "../styles";

/**
 * Shape used by factories — a StateNode without an id.
 * The engine assigns IDs during INSERT_NODE action handling.
 */
export interface NewNode {
  readonly type: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly style: Readonly<Style>;
  readonly children: readonly NewNode[];
}
