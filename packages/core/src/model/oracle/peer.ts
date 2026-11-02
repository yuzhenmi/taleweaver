import type * as Y from "yjs";
import { type EditKind, ModelHistory } from "../history";
import { Model } from "../model";
import type { ModelSelection } from "../position/model-position";
import { createEditorOrigin } from "../storage/history-hooks";

export class Peer {
  readonly model: Model;
  readonly origin: symbol;
  readonly history: ModelHistory;
  selection: ModelSelection | null = null;
  clock = 0;
  /** Updates from other peers not yet applied here. */
  readonly inbox: Uint8Array[] = [];
  /** Item (per character) → the global seq at which this peer first saw it deleted. */
  readonly deletedSeen = new Map<string, number>();
  /** Inside `history.apply` (O3: only then may this peer's editor origin write). */
  applying = false;
  /** Inside `history.undo` / `redo`: what its UndoManager transaction is (O3: only then may it write). */
  stepping: "undo" | "redo" | null = null;
  /** A yjs-undo O1 event happened here: its in-memory doc is not its storage; its early O1 / O5 checks stop. */
  diverged = false;
  /** The expected undo grouping (computed here, not read from ModelHistory): the open entry's kind and last edit time. */
  expOpen: EditKind | null = null;
  expLast = 0;
  /** The command being applied (log label). */
  label = "";
  /** An O3 violation seen inside a Yjs event handler, thrown after the call. */
  o3: string | null = null;

  constructor(
    readonly index: number,
    readonly doc: Y.Doc,
  ) {
    this.model = new Model(doc);
    this.origin = createEditorOrigin(`peer-${index}`);
    this.history = new ModelHistory(this.model, this.origin, () => this.clock);
  }
}
