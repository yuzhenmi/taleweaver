import type * as Y from "yjs";

export interface DeltaOp {
  readonly insert?: unknown;
  readonly delete?: number;
  readonly retain?: number;
  readonly attributes?: unknown;
}

export interface PieceChange {
  /** Rebuild the piece's whole subtree (an unrecognised change inside it). */
  full: boolean;
  delta: readonly DeltaOp[] | null;
  /** Embedded items (¶, object, …) whose map keys changed. */
  readonly mapItems: Y.Item[];
}

export interface FlowChange {
  /** The flow's own (top-level) piece array changed. */
  arrayChanged: boolean;
  /** Sub-flow piece arrays that changed (their owning piece's subtree is rebuilt). */
  readonly subArrays: Set<Y.Array<Y.Text>>;
  /** Every changed piece, top-level or nested. */
  readonly pieces: Map<Y.Text, PieceChange>;
  /** Tables' `⟦` maps whose `cols` or `a:*` keys changed: only their records' attrs are re-read (`table-widths.ts`). */
  readonly tableCols: Set<Y.Map<unknown>>;
}
