import { createEmptyDocument, History, createHistory, positionsEqual } from "../state";
import { DOCUMENT_INTERNAL } from "../state/document-internal";
import { EDITOR_INTERNAL, ACTION_FAILURES } from "./editor-internal";
import { bindAttrRegistry } from "../state/mark-attrs";
import type { ProposalOutcome } from "./proposals";
import { compileKeymap, type ActiveTrigger } from "./extensions";
import type { Document, Selection, BlockId, Position, ReadonlyAttrs } from "../state";
import type { CaretAffinity } from "../cursor/selection";
import type { EditorConfig } from "./editor-config";
import type { EditorAction } from "./editor-action";
import { reduceEditor } from "./reduce-editor";
import type { DocumentChange } from "./document-change";
import { initialSelectionForDocument } from "./actions/helpers/initial-selection-for-document";

/** Report an error without unwinding the caller (as a DOM event listener's error is). */
function reportError(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

// --- Editor ---

/**
 * The editor's fields (see `Editor`): written only by the reducer and the other internal
 * writers, through `editor[EDITOR_INTERNAL]`; read through the editor's getters.
 */
export interface EditorFields {
  /**
   * The editor's environment (registries, clock, suggesting author, extensions). The
   * registries are fixed for the editor's lifetime — the attr registry is bound to the
   * document once, at construction. The rest may be replaced with `setConfig`
   * (e.g. entering suggesting mode).
   */
  config: EditorConfig;
  document: Document;
  selection: Selection;
  readonly history: History;
  /**
   * What this dispatch changed: the set of block ids whose own
   * attrs/content changed in the action that produced THIS state — the
   * geometry-free hand-off to the print backend's layout-driver, which consumes
   * it to rebuild the render→cascade→layout tree INCREMENTALLY (reusing unchanged
   * subtrees by reference). Core's reducer is geometry-free; it records WHAT
   * changed but never runs layout.
   *
   * `null` means "no incremental hint" — a FULL rebuild: a selection-only /
   * inert action (no document mutation), the initial build, or a container-width
   * resize. Within the reducer dispatch cycle a non-null (possibly empty) set is
   * written ONLY by `applyEdit`, so a mutating action's dirty ids never leak
   * forward onto a later selection-only action (the reducer's entry-clear
   * enforces this). NON-undoable, transient view/hand-off state — never in `History`, never part
   * of `Position` / `Selection`.
   */
  lastDirtyIds: ReadonlySet<BlockId> | null;
  /**
   * The most recent DOCUMENT change that produced `document`: the Document it was made from and
   * its raw dirty set. Unlike `lastDirtyIds` it survives later selection-only / inert
   * actions, so a consumer holding an older snapshot can still map positions across
   * "edit, then move the caret". `null` when the last change's extent is unknown (initial
   * state, a wholesale replacement). Read by `transitionMapping` (decorations, anchors).
   * NON-undoable transient state, like `lastDirtyIds`.
   */
  lastChange: DocumentChange | null;
  containerWidth: number;
  targetX: number | null;
  /**
   * NON-undoable view state: which page's header/footer SLOT instance the
   * caret is visually on. A header/footer body is ONE shared `templateContents`
   * subtree rendered into EVERY page's slot, so a slot caret `Position` is
   * page-AMBIGUOUS; this records the page the user is editing so caret-render
   * resolves on that page (via `getPage(hint)`, O(1)) instead of always pinning
   * to the body's first carrying page. `undefined` for a body caret /
   * single-page doc.
   *
   * Lifecycle (the OPPOSITE model from `targetX`, which is centrally cleared in
   * `reduceEditor`): set by `SET_SELECTION` (the controller passes the clicked
   * page), PRESERVED through other handlers, and
   * cleared EXPLICITLY only by undo/redo (post-restore page is ambiguous) and a
   * body `SET_SELECTION` (which passes no hint). It is view state — never stored
   * in `History`, never part of `Position` / `Selection`.
   */
  caretPageHint?: number;
  /**
   * NON-undoable view state: the caret ASSOCIATION (which logical
   * side a collapsed caret sticks to) at a bidi direction boundary. One logical
   * `offset` has TWO visual positions at an LTR↔RTL boundary; `"before"` draws
   * the caret at the trailing edge of the leaf ENDING at the offset, `"after"`
   * at the leading edge of the leaf STARTING at it. `undefined` / `"after"` is
   * today's LTR behavior (both sides give the same X on a uniform line, so the
   * field is inert there).
   *
   * Lifecycle (the same OPPOSITE-of-`targetX` model as `caretPageHint`): SET by
   * mouse hit-test (from the hit side) and by visual-order arrow motion at a
   * boundary flip; RESET to `undefined` by edits and non-arrow selection changes
   * so it never goes stale. It is VIEW state — never stored in `History`, never
   * part of `Position` / `Selection` / `Span`. This field + its default are the
   * shared primitive the handlers (the central reset + the hit-test / arrow
   * writes) use.
   */
  caretAffinity?: CaretAffinity;
  /**
   * NON-undoable view state: the ANCHOR's caret-boundary association at a
   * bidi direction boundary — the symmetric twin of `caretAffinity` (the FOCUS's
   * boundary side). The print backend's NavIntent resolver seeds it
   * (on the collapse→extend transition, via the barrel-exported `seedAnchorAffinity`)
   * and threads it through the `SET_SELECTION` it dispatches; thereafter it persists
   * through continued extension. Clears on any action but `SET_SELECTION` (the same
   * central-reset model as `caretAffinity`). It is VIEW state — never stored in
   * `History`, never part of `Position` / `Selection` / `Span`.
   */
  anchorAffinity?: CaretAffinity;
  /**
   * The user's own anchor, when `selection.anchor` is that anchor lifted to a whole
   * table (`normalizeSelectionForObjects`). A selection extended from the lifted
   * anchor (Shift+Arrow, shift-click) restarts from this one, so moving the focus
   * back into the table selects from the original caret again (as a mouse drag
   * does). Cleared by any document change and whenever the anchor is not lifted.
   */
  anchorBeforeLift?: Position;
  /**
   * Pending TYPING ATTRS (word-processor "stored marks"): the attrs the next typed
   * text takes instead of those inherited at the caret. Set by a format command at
   * a collapsed caret (Bold with nothing selected → the next keystroke is bold) and
   * when an edit empties the caret's block (the deleted / split-off text's
   * formatting carries over, as in Google Docs / Word). `undefined` = inherit.
   *
   * Lifecycle: cleared by every action except the one that set it, an inert
   * action, and a `SET_SELECTION` to the same selection — so any caret move or
   * document edit (including the typing that consumes it) drops it. NON-undoable
   * view state, never in `History`. Read it through `getTypingAttrs`.
   */
  storedAttrs?: ReadonlyAttrs;
  /**
   * The host trigger the user is typing (`EditorExtensions.triggers`): its start
   * `from` (mapped through every edit), the caret `to`, and the `query` typed after
   * the trigger text. Maintained centrally by `reduceEditor`; ends on ESCAPE, when the
   * caret leaves it or its text stops matching. NON-undoable view state.
   */
  activeTrigger?: ActiveTrigger;
  /**
   * The reducer's verdict on the most recent `PROPOSE` (applied / stale / rejected, with
   * the problem); `dispatchProposal` resolves a host's `propose()` from it. View state, never in history.
   */
  lastProposal?: ProposalOutcome;
}

/** The part of the editor a change is measured against: the document version and the selection before it. */
export interface EditorSnapshot {
  readonly document: Document;
  readonly selection: Selection;
}

/** One dispatch, as a listener sees it: the action and the editor before it. */
export interface EditorChange {
  readonly action: EditorAction;
  readonly before: EditorSnapshot;
}

export type EditorListener = (change: EditorChange) => void;

/**
 * The editor: one long-lived, mutable object per editing session — the document, the
 * selection, the undo history and the view state (see `EditorFields` for each field).
 * `dispatch` runs an action, which changes the editor in place, then tells every
 * subscriber. The fields are read-only from outside: only `dispatch` (and `setConfig`)
 * change them.
 *
 * The `document` is still a new `Document` handle after every change: it names that
 * version of the document (anchors, `PROPOSE.basedOn` and the mapping log key on it).
 */
export class Editor {
  readonly [EDITOR_INTERNAL]: EditorFields;
  readonly #listeners = new Set<EditorListener>();
  /** The running action first, then the ones dispatched while it runs (see `dispatch`). */
  readonly #queue: EditorAction[] = [];

  constructor(config: EditorConfig, document: Document, selection: Selection, historyOrigin: unknown) {
    // Every document writer judging an attr (¶ markAttrs, one-shot attrs) reads it from the doc.
    bindAttrRegistry(document[DOCUMENT_INTERNAL].doc, config.attrRegistry);
    // Parse the host keymap now: a malformed binding name fails at configuration time.
    if (config.extensions?.keymap !== undefined) compileKeymap(config.extensions.keymap);
    this[EDITOR_INTERNAL] = {
      config,
      document,
      selection,
      history: createHistory(document, undefined, historyOrigin),
      lastDirtyIds: null,
      lastChange: null,
      containerWidth: config.containerWidth,
      targetX: null,
    };
  }

  get config(): EditorConfig {
    return this[EDITOR_INTERNAL].config;
  }
  get document(): Document {
    return this[EDITOR_INTERNAL].document;
  }
  get selection(): Selection {
    return this[EDITOR_INTERNAL].selection;
  }
  get history(): History {
    return this[EDITOR_INTERNAL].history;
  }
  get lastDirtyIds(): ReadonlySet<BlockId> | null {
    return this[EDITOR_INTERNAL].lastDirtyIds;
  }
  get lastChange(): DocumentChange | null {
    return this[EDITOR_INTERNAL].lastChange;
  }
  get containerWidth(): number {
    return this[EDITOR_INTERNAL].containerWidth;
  }
  get targetX(): number | null {
    return this[EDITOR_INTERNAL].targetX;
  }
  get caretPageHint(): number | undefined {
    return this[EDITOR_INTERNAL].caretPageHint;
  }
  get caretAffinity(): CaretAffinity | undefined {
    return this[EDITOR_INTERNAL].caretAffinity;
  }
  get anchorAffinity(): CaretAffinity | undefined {
    return this[EDITOR_INTERNAL].anchorAffinity;
  }
  get storedAttrs(): ReadonlyAttrs | undefined {
    return this[EDITOR_INTERNAL].storedAttrs;
  }
  get activeTrigger(): ActiveTrigger | undefined {
    return this[EDITOR_INTERNAL].activeTrigger;
  }
  get lastProposal(): ProposalOutcome | undefined {
    return this[EDITOR_INTERNAL].lastProposal;
  }

  /** The document version and selection now — what a later change is measured against. */
  snapshot(): EditorSnapshot {
    return { document: this.document, selection: this.selection };
  }

  /**
   * Replace the environment (e.g. enter suggesting mode); the registries must stay the
   * same (see `EditorFields.config`) — a different one throws, as does a malformed host
   * keymap. Takes effect from the next dispatch; subscribers are not notified.
   */
  setConfig(config: EditorConfig): void {
    const current = this[EDITOR_INTERNAL].config;
    if (config.componentRegistry !== current.componentRegistry || config.attrRegistry !== current.attrRegistry) {
      throw new Error("Editor.setConfig: the component and attr registries are fixed for the editor's lifetime");
    }
    // Parse the host keymap now, as the constructor does: a malformed binding fails here.
    if (config.extensions?.keymap !== undefined) compileKeymap(config.extensions.keymap);
    this[EDITOR_INTERNAL].config = config;
  }

  /**
   * Run `action`, changing the editor in place, then call every subscriber. An action
   * that throws leaves the editor as it was and the error escapes; subscribers are not
   * called.
   *
   * A dispatch from inside a dispatch (a subscriber reacting to a change) is queued: it
   * runs once every subscriber has seen the current change, so each subscriber sees the
   * changes one at a time, in order. As with DOM event listeners, a subscriber that throws
   * stops nothing: its error is reported asynchronously and the other subscribers and the
   * queued actions still run. A queued action that throws (its caller has already
   * returned) is rolled back and reported the same way. The outermost action's error
   * escapes only once the queue has drained, so actions dispatched while it ran (before
   * it failed) still run.
   */
  dispatch(action: EditorAction): void {
    this.#queue.push(action);
    if (this.#queue.length > 1) return;
    let failed: { readonly error: unknown } | null = null;
    try {
      for (let i = 0, next = this.#queue[0]; next !== undefined; next = this.#queue[++i]) {
        const before = this.snapshot();
        try {
          reduceEditor(this, next);
        } catch (error) {
          if (i === 0) failed = { error };
          else {
            reportError(error);
            ACTION_FAILURES.get(next)?.();
          }
          continue;
        }
        const change: EditorChange = { action: next, before };
        for (const listener of [...this.#listeners]) {
          try {
            listener(change);
          } catch (error) {
            reportError(error);
          }
        }
      }
    } finally {
      this.#queue.length = 0;
    }
    if (failed !== null) throw failed.error;
  }

  /** Call `listener` after every dispatch. Returns the unsubscribe function. */
  subscribe(listener: EditorListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

/** What an editor starts from: the document (default: an empty one), the selection
 *  (default: its start) and the transaction origin its `History` tracks for undo. */
export interface CreateEditorOptions {
  readonly document?: Document;
  readonly selection?: Selection;
  /**
   * The transaction origin the editor's `History` tracks (default `null`, the
   * single-editor origin). A collaborating peer passes its own token so its undo covers
   * only its own edits.
   */
  readonly historyOrigin?: unknown;
}


/**
 * A new editor over `options.document` (default: an empty document). Core builds no
 * render / cascade / layout trees: a backend's layout driver builds them from `document`
 * (`lastDirtyIds: null` asks it for a full first build).
 */
export function createEditor(config: EditorConfig, options: CreateEditorOptions = {}): Editor {
  const document = options.document ?? createEmptyDocument({ resolver: config.componentRegistry });
  const selection = options.selection ?? initialSelectionForDocument(document);
  return new Editor(config, document, selection, options.historyOrigin ?? null);
}


/**
 * Reset the transient VIEW fields that go stale on any document mutation:
 * `targetX` (line-nav sticky goal column) and `caretAffinity` / `anchorAffinity`
 * (bidi-boundary seeds). Each is resolved against a specific document/layout
 * shape, so any edit invalidates it.
 *
 * The SINGLE home for "what counts as stale-on-mutation view state". Every
 * document change routes through here — the reducer
 * (after every non-`SET_SELECTION` action) and `reconcileForeignChange` (after a
 * peer's foreign edit) — so a new producer can't silently forget a field.
 */
export function clearTransientViewState(editor: Editor): void {
  const fields = editor[EDITOR_INTERNAL];
  fields.targetX = null;
  fields.caretAffinity = undefined;
  fields.anchorAffinity = undefined;
}

/**
 * The shared `anchorAffinity` seed/persist rule for the three focus-only
 * selection extenders — `EXPAND_SELECTION` (Shift+ArrowLeft/Right), `EXPAND_LINE`
 * (Shift+ArrowUp/Down), `EXPAND_LINE_BOUNDARY` (Shift+Home/End).
 * These extenders live in the print backend's NavIntent resolver, which imports
 * this barrel-exported helper to compute the `anchorAffinity` it threads into the
 * `SET_SELECTION` it dispatches. They all keep the ANCHOR fixed and move only the
 * FOCUS, so the anchor's bidi-boundary side must be captured ONCE — on the
 * genuine collapse→extend transition — and then PERSIST through continued
 * extension (the central reset exempts `SET_SELECTION`, the action they dispatch).
 *
 * Contract:
 *   - On the collapse→extend transition (`isCollapsed && anchorAffinity ===
 *     undefined`) SEED from the caret's boundary side (`editor.caretAffinity`),
 *     so a selection STARTED by ANY of the three extenders renders the anchor
 *     edge on the correct visual side of a bidi boundary on the first line.
 *   - Otherwise PERSIST the existing `editor.anchorAffinity` (continued
 *     extension; a non-collapsed span; an already-seeded anchor).
 *
 * The two guards are load-bearing (see `handleExpandSelection`'s longer note):
 * `isCollapsed` gates the LTR inert-affinity latching case, and `anchorAffinity
 * === undefined` gates the bidi transient-collapse re-seed case. A fresh caret
 * always has `anchorAffinity === undefined`, so a NEW selection seeds correctly.
 * Living here keeps the rule in ONE place across the three extenders.
 */
export function seedAnchorAffinity(editor: Editor): CaretAffinity | undefined {
  const isCollapsed = positionsEqual(editor.selection.anchor, editor.selection.focus);
  return isCollapsed && editor.anchorAffinity === undefined
    ? editor.caretAffinity // seed from the caret's boundary side on first extend
    : editor.anchorAffinity; // persist on continued extension
}
