import type * as Y from "yjs";
import type { CounterStyle } from "../../styles/format-counter";
import type { Block, BlockId } from "../block";
import type { ObjectKindRegistry } from "../object-kinds";
import type { PMap } from "../pmap";
import type { Segment } from "../scan/tokens";

export type TreeKind = "block" | "embedContent" | "templateContent";

export interface SectionInfo {
  readonly id: BlockId;
  /** The `[S]` map holding the section's props (DocMap for the last section). */
  readonly map: Y.Map<unknown>;
}

/** Derivation state of one flow (internal to the model). */
export interface FlowState {
  readonly holderId: BlockId;
  readonly tree: TreeKind;
  readonly isRoot: boolean;
  readonly array: Y.Array<Y.Text> | null;
  /** The flow's segments in reading order (`scan/`). */
  readonly segments: readonly Segment[];
  /** Piece → the indices of its segments in `segments` (ascending). */
  readonly segIndex: ReadonlyMap<Y.Text, readonly number[]>;
  /** Body flow only: its sections in order, the last one `${root}/final`. */
  readonly sections: readonly SectionInfo[];
  /** R17 fired: the flow reads as one synthetic empty paragraph. */
  readonly synthetic: boolean;
}

export interface TableTrack {
  /** The row's / column's track key (R6: unique per table, first wins). */
  readonly key: string;
  readonly map: Y.Map<unknown>;
}

/** A RowMap's `c:<col>:rowSpanTo` / `c:<col>:colSpanTo` (R7: resolved against the track indices when admitted). */
export interface SpanRequest {
  readonly rowTo: unknown;
  readonly colTo: unknown;
}

export interface TableRowInfo extends TableTrack {
  /** The RowMap's item id: the row record's id. */
  readonly id: BlockId;
  /** `header === true` (R6h reads the leading run). */
  readonly header: boolean;
  /** The row's span keys, by column key (the table's columns when the row was read). */
  readonly spans: ReadonlyMap<string, SpanRequest>;
}

/** A rendered cell: an admitted anchor slot (R7) and the rectangle it spans (its row: the `rowCells` entry holding it). */
export interface TableCellInfo {
  readonly id: BlockId;
  readonly colKey: string;
  readonly rowSpan: number;
  readonly colSpan: number;
  // The cell's flow is its FlowState's (`flows`), its attrs its record's.
}

/** Derivation state of one table (internal to the model; plans read it). */
export interface TableState {
  readonly id: BlockId;
  readonly map: Y.Map<unknown>;
  readonly tree: TreeKind;
  /** R6 rows / columns, and their key → index. */
  readonly rows: readonly TableRowInfo[];
  readonly cols: readonly TableTrack[];
  readonly rowIndex: ReadonlyMap<string, number>;
  readonly colIndex: ReadonlyMap<string, number>;
  /** Rendered cells per row (aligned with `rows`). Empty when the table has no row or no column. */
  readonly rowCells: readonly (readonly TableCellInfo[])[];
  /** R6h: rendered header rows. */
  readonly headerCount: number;
  /** R10: normalised column widths, or null (auto layout). */
  readonly widths: readonly number[] | null;
}

export type ListRestart = "always" | "never" | "after-break";

export interface ListLevelDef {
  readonly style: CounterStyle;
  readonly start: number;
  readonly restart: ListRestart;
}

export interface ListDef {
  readonly levels: readonly ListLevelDef[];
}

/** An immutable version of the document (D4/D6: the version IS the Document). */
export interface Document {
  readonly rootId: BlockId;
  readonly trees: Readonly<Record<TreeKind, PMap<Block>>>;
  readonly flows: PMap<FlowState>;
  readonly tables: PMap<TableState>;
  readonly listDefs: ReadonlyMap<string, ListDef>;
  /** Internal: what derivation reads (not part of the read API). */
  readonly docMap: Y.Map<unknown>;
  readonly registry: ObjectKindRegistry;
}
