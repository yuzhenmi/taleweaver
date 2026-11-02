/**
 * H1 — undo / redo over plain `Y.UndoManager` (r7 §5 H1):
 *   - `trackedOrigins` = this editor's `Symbol` origin only (X16): remote updates and
 *     other editors' writes are never captured, so a local undo never undoes them;
 *   - `deleteFilter` = {@link flowContainerDeleteFilter} (X17): an undo never deletes
 *     a flow container, so a peer's text inside a container this editor created
 *     survives;
 *   - `captureTimeout` = MAX with an explicit `stopCapturing` per entry: one command
 *     is one undo step, except typing coalescing (below);
 *   - the selection before / after each entry is stored as Yjs RelativePositions,
 *     keyed by its `StackItem`, and restored by undo (before) / redo (after);
 *   - no depth trim.
 *
 * Coalescing (today's `state/history.ts` + `editor/reduce-editor.ts` rule): an
 * `insert` (C1) or `delete` (Backspace / Delete / range delete) edit joins the open
 * entry when the open entry is of the same kind and less than
 * {@link UNDO_COALESCE_PAUSE_MS} passed since its last edit; every `command` starts
 * its own entry and closes it. A caret move / selection change ({@link
 * ModelHistory.breakCoalescing}) and undo / redo close the open entry. A coalesced
 * entry keeps its first edit's `before` selection and advances `after`.
 *
 * Undo / redo are ordinary Yjs transactions, so they reach the model's change
 * pipeline like any other write (one version, dirty ids, exact mapping).
 */
import * as Y from "yjs";
import type { Document } from "./document/types";
import type { Model } from "./model";
import { applyPlan, type Plan } from "./plan";
import type { Assoc, ModelPosition, ModelSelection } from "./position/model-position";
import { paragraphLayout } from "./position/paragraph-layout";
import { comparePoints, pointBefore } from "./position/storage-points";
import { fromRelativePosition, toRelativePosition } from "./mapping/relative-position";
import { flowContainerDeleteFilter } from "./storage/history-hooks";
import { ROOT_MAP } from "./storage/keys";

/** Pause (ms) that ends a typing run (today's `UNDO_COALESCE_PAUSE_MS`). */
export const UNDO_COALESCE_PAUSE_MS = 500;

/** How an edit groups into undo entries. */
export type EditKind = "insert" | "delete" | "command";

interface StoredPosition {
  readonly rel: Y.RelativePosition;
  readonly assoc: Assoc;
  readonly leading: boolean;
}
interface StoredSelection {
  readonly anchor: StoredPosition;
  readonly focus: StoredPosition;
}
interface Entry {
  readonly before: StoredSelection | null;
  readonly after: StoredSelection | null;
}

/** What an undo / redo did. `selection`: the one to restore; null when it no longer resolves (e.g. a peer removed the flow holding it). */
export interface HistoryStep {
  readonly selection: ModelSelection | null;
}

/** Is `a` at or before `b` (same flow; positions of different flows count as ordered)? */
function inOrder(d: Document, a: ModelPosition, b: ModelPosition): boolean {
  if (a.blockId === b.blockId) return a.offset <= b.offset;
  const La = paragraphLayout(d, a.blockId);
  const Lb = paragraphLayout(d, b.blockId);
  const pa = La === null ? null : pointBefore(La, a.offset);
  const pb = Lb === null ? null : pointBefore(Lb, b.offset);
  return pa === null || pb === null || La?.fs !== Lb?.fs || comparePoints(pa, pb) <= 0;
}

function storePosition(d: Document, p: ModelPosition, assoc: Assoc): StoredPosition | null {
  const rel = toRelativePosition(d, p, assoc);
  return rel === null ? null : { rel, assoc, leading: p.leading === true };
}

/**
 * `sel` as RelativePositions in version `d`. A range's ends stick inward (the start
 * to the unit after it, the end to the unit before it), so restoring a deleted range
 * re-selects exactly the restored text; a caret sticks to the unit after it.
 */
function storeSelection(d: Document, sel: ModelSelection): StoredSelection | null {
  const collapsed = sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset;
  const anchorFirst = collapsed || inOrder(d, sel.anchor, sel.focus);
  const anchor = storePosition(d, sel.anchor, collapsed || anchorFirst ? 1 : -1);
  const focus = collapsed ? anchor : storePosition(d, sel.focus, anchorFirst ? -1 : 1);
  return anchor === null || focus === null ? null : { anchor, focus };
}

function restorePosition(d: Document, s: StoredPosition): ModelPosition | null {
  const p = fromRelativePosition(d, s.rel, s.assoc);
  if (p === null || paragraphLayout(d, p.blockId) === null) return null;
  return s.leading && p.offset === 0 ? { ...p, leading: true } : p;
}

function restoreSelection(d: Document, s: StoredSelection | null): ModelSelection | null {
  if (s === null) return null;
  const anchor = restorePosition(d, s.anchor);
  const focus = restorePosition(d, s.focus);
  if (anchor === null) return focus === null ? null : { anchor: focus, focus };
  return { anchor, focus: focus ?? anchor };
}

export class ModelHistory {
  private readonly undoManager: Y.UndoManager;
  private open: EditKind | null = null;
  private lastEdit = 0;
  /** Each stack item's selections. */
  private readonly entries = new WeakMap<object, Entry>();
  /** The stack item the last tracked transaction added or extended. */
  private touched: object | null = null;
  private readonly onItem = (e: { stackItem: object }): void => {
    this.touched = e.stackItem;
  };

  constructor(
    readonly model: Model,
    readonly origin: symbol,
    private readonly now: () => number = Date.now,
  ) {
    this.undoManager = new Y.UndoManager(model.doc.getMap(ROOT_MAP), {
      trackedOrigins: new Set([origin]),
      deleteFilter: flowContainerDeleteFilter,
      captureTimeout: Number.MAX_SAFE_INTEGER,
    });
    this.undoManager.on("stack-item-added", this.onItem);
    this.undoManager.on("stack-item-updated", this.onItem);
  }

  /**
   * Apply `plan` as one undoable edit of `kind`; `selection` is the selection the
   * command was planned from (restored by its undo). The selection after, or null when
   * the plan was refused (nothing written, nothing recorded).
   */
  apply(plan: Plan, kind: EditKind, selection: ModelSelection): ModelSelection | null {
    if (plan.base !== this.model.version || this.model.busy) return null;
    const t = this.now();
    const coalesce = kind !== "command" && kind === this.open && t - this.lastEdit < UNDO_COALESCE_PAUSE_MS && this.undoManager.undoStack.length > 0;
    // Closing the open entry is final even when this edit then writes nothing (today's rule: a
    // no-op command still ends a typing run).
    if (!coalesce) this.breakCoalescing();
    const before = coalesce ? null : storeSelection(plan.base, selection);
    this.touched = null;
    const after = applyPlan(this.model, plan, this.origin);
    if (after === null) return null;
    const item = this.takeTouched();
    // A plan whose writes changed nothing adds no stack item: the open entry stays as it was.
    if (item === null) return after;
    const prev = coalesce ? this.entries.get(item) : undefined;
    this.entries.set(item, { before: coalesce ? (prev?.before ?? null) : before, after: storeSelection(this.model.version, after) });
    this.open = kind === "command" ? null : kind;
    this.lastEdit = t;
    return after;
  }

  /** Close the open entry (a caret move or selection change): the next edit starts a new one. */
  breakCoalescing(): void {
    this.undoManager.stopCapturing();
    this.open = null;
  }

  /** Drop every entry (both stacks); the next edit starts a new one. */
  clear(): void {
    this.undoManager.clear();
    this.open = null;
    this.lastEdit = 0;
  }

  /** Entries on the undo / redo stack. */
  depths(): { readonly undo: number; readonly redo: number } {
    return { undo: this.undoManager.undoStack.length, redo: this.undoManager.redoStack.length };
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  /** Undo the last entry (restoring the selection before it); null when nothing was undone. */
  undo(): HistoryStep | null {
    return this.step(true);
  }

  /** Redo the last undone entry (restoring the selection after it); null when nothing was redone. */
  redo(): HistoryStep | null {
    return this.step(false);
  }

  destroy(): void {
    this.undoManager.off("stack-item-added", this.onItem);
    this.undoManager.off("stack-item-updated", this.onItem);
    this.undoManager.destroy();
  }

  private takeTouched(): object | null {
    const t = this.touched;
    this.touched = null;
    return t;
  }

  private step(undo: boolean): HistoryStep | null {
    // Inside a transaction (or its observers) the version may not describe storage.
    if (this.model.busy) return null;
    this.breakCoalescing();
    this.touched = null;
    const popped = undo ? this.undoManager.undo() : this.undoManager.redo();
    if (popped === null) return null;
    const entry = this.entries.get(popped);
    // The undo / redo pushed a new item on the opposite stack: carry the entry over.
    const moved = this.takeTouched();
    if (entry !== undefined && moved !== null) this.entries.set(moved, entry);
    return { selection: restoreSelection(this.model.version, entry === undefined ? null : undo ? entry.before : entry.after) };
  }
}
