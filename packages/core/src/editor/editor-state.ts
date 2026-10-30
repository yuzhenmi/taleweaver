import { createEmptyDocument, History, createHistory, positionsEqual } from "../state";
import { STATE_INTERNAL } from "../state/state-internal";
import { bindAttrRegistry } from "../state/mark-attrs";
import type { ProposalOutcome } from "./proposals";
import type { ActiveTrigger } from "./extensions";
import type { State, Selection, BlockId, ReadonlyAttrs } from "../state";
import type { CaretAffinity } from "../cursor/selection";
import type { EditorConfig } from "./editor-config";
import type { DocumentChange } from "./document-change";
import { initialSelectionForState } from "./actions/helpers";

// --- EditorState ---

export interface EditorState {
  readonly state: State;
  readonly selection: Selection;
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
   * written ONLY by `rebuildTrees`, so a mutating action's dirty ids never leak
   * forward onto a later selection-only action's state (the reducer's entry-clear
   * enforces this). The ONE writer OUTSIDE the reducer is
   * `reconcileForeignChange` (a collab peer's edit): it sets a non-null set
   * directly, which is sound because it produces a whole new `EditorState` the
   * host swaps in atomically (no in-flight dispatch can observe a stale value).
   * NON-undoable, transient view/hand-off state — never in `History`, never part
   * of `Position` / `Selection`.
   */
  readonly lastDirtyIds: ReadonlySet<BlockId> | null;
  /**
   * The most recent DOCUMENT change that produced `state`: the State it was made from and
   * its raw dirty set. Unlike `lastDirtyIds` it survives later selection-only / inert
   * actions, so a consumer holding an older EditorState can still map positions across
   * "edit, then move the caret". `null` when the last change's extent is unknown (initial
   * state, a wholesale replacement). Read by `transitionMapping` (decorations, anchors).
   * NON-undoable transient state, like `lastDirtyIds`.
   */
  readonly lastChange: DocumentChange | null;
  readonly containerWidth: number;
  readonly targetX: number | null;
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
   * page), PRESERVED through other handlers by their `{...editor}` spread, and
   * cleared EXPLICITLY only by undo/redo (post-restore page is ambiguous) and a
   * body `SET_SELECTION` (which passes no hint). It is view state — never stored
   * in `History`, never part of `Position` / `Selection`.
   */
  readonly caretPageHint?: number;
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
  readonly caretAffinity?: CaretAffinity;
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
  readonly anchorAffinity?: CaretAffinity;
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
  readonly storedAttrs?: ReadonlyAttrs;
  /**
   * The host trigger the user is typing (`EditorExtensions.triggers`): its start
   * `from` (mapped through every edit), the caret `to`, and the `query` typed after
   * the trigger text. Maintained centrally by `reduceEditor`; ends on ESCAPE, when the
   * caret leaves it or its text stops matching. NON-undoable view state.
   */
  readonly activeTrigger?: ActiveTrigger;
  /**
   * The reducer's verdict on the most recent `PROPOSE` (applied / stale / rejected, with
   * the problem). A host that dispatches proposals asynchronously (print) reads the
   * outcome here on the next state. View state, never in history.
   */
  readonly lastProposal?: ProposalOutcome;
}


export function createInitialEditorState(config: EditorConfig): EditorState {
  const state = createEmptyDocument({ resolver: config.componentRegistry });
  const selection = initialSelectionForState(state);
  return createEditorStateFromState(state, selection, config);
}

/**
 * Build a fresh `EditorState` from an arbitrary `State` + initial `Selection`
 * (a fresh `History` bound to that state). `createInitialEditorState` delegates
 * here with the empty document. Primarily for tests that need a non-default seed
 * document (e.g. a table-only body) without an editor-from-state injection seam.
 *
 * Core is geometry-free. This builds NO render/cascade/layout trees —
 * the print backend's layout-driver owns that pipeline and rebuilds it from
 * `state` after each dispatch. `lastDirtyIds: null` signals the driver to do a
 * FULL initial build.
 *
 * `historyOrigin` is the transaction origin the editor's `History` tracks for
 * undo (default `null` = the single-editor origin). A collaborating peer passes
 * its own origin token so its `UndoManager` tracks ONLY its own edits (undo
 * isolation) — building the right History up front instead of replacing a
 * default one (which would leak the default's UndoManager listener).
 */
export function createEditorStateFromState(
  state: State,
  selection: Selection,
  config: EditorConfig,
  historyOrigin: unknown = null,
): EditorState {
  // Every state writer judging an attr (¶ markAttrs, one-shot attrs) reads it from the doc.
  bindAttrRegistry(state[STATE_INTERNAL].doc, config.attrRegistry);
  return {
    state,
    selection,
    history: createHistory(state, undefined, historyOrigin),
    lastDirtyIds: null,
    lastChange: null,
    containerWidth: config.containerWidth,
    targetX: null,
    caretPageHint: undefined,
    caretAffinity: undefined,
    anchorAffinity: undefined,
  };
}


/**
 * Reset the transient VIEW fields that go stale on any document mutation:
 * `targetX` (line-nav sticky goal column) and `caretAffinity` / `anchorAffinity`
 * (bidi-boundary seeds). Each is resolved against a specific document/layout
 * shape, so any edit invalidates it. Allocation-guarded — returns `editor`
 * unchanged when all three are already cleared.
 *
 * The SINGLE home for "what counts as stale-on-mutation view state". Every
 * producer of a post-mutation `EditorState` routes through here — the reducer
 * (after every non-`SET_SELECTION` action) and `reconcileForeignChange` (after a
 * peer's foreign edit) — so a new producer can't silently forget a field.
 */
export function clearTransientViewState(editor: EditorState): EditorState {
  if (
    editor.targetX === null &&
    editor.caretAffinity === undefined &&
    editor.anchorAffinity === undefined
  ) {
    return editor;
  }
  return {
    ...editor,
    targetX: null,
    caretAffinity: undefined,
    anchorAffinity: undefined,
  };
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
export function seedAnchorAffinity(editor: EditorState): CaretAffinity | undefined {
  const isCollapsed = positionsEqual(editor.selection.anchor, editor.selection.focus);
  return isCollapsed && editor.anchorAffinity === undefined
    ? editor.caretAffinity // seed from the caret's boundary side on first extend
    : editor.anchorAffinity; // persist on continued extension
}
