import type * as Y from "yjs";
import type { CounterStyle } from "../../styles/format-counter";
import type { Block, BlockId } from "../block";
import type { ObjectKindRegistry } from "../object-kinds";
import type { PMap } from "../pmap";
import type { Segment } from "../scan/tokens";
import type { TableForm } from "../derive/table/table-form";

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
  /** Some table mark reads inert (RT1): `segments` hold it as an inert run unit; N1: any change re-derives the flow. */
  readonly inertMarks: boolean;
  /** Its tables' forming state, by `⟦` id (nested ones included; N2's row splice). */
  readonly tables: PMap<TableForm>;
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
  readonly listDefs: ReadonlyMap<string, ListDef>;
  /** Internal: what derivation reads (not part of the read API). */
  readonly docMap: Y.Map<unknown>;
  readonly registry: ObjectKindRegistry;
}
