/**
 * Shared setup for the print-backend NAVIGATION tests (Phase 0b, Slice 3★).
 *
 * Core's reducer is geometry-free: the seven geometric-nav handlers (MOVE_CURSOR /
 * EXPAND_SELECTION / MOVE_LINE / EXPAND_LINE / MOVE_LINE_BOUNDARY /
 * EXPAND_LINE_BOUNDARY / DELETE_LINE) moved to `nav-intent.ts`'s `resolveNavIntent`,
 * which reads the DRIVER-built layout tree + measurer to compute geometry and
 * returns a geometry-free `SET_SELECTION` / `DELETE_RANGE` for core to apply.
 *
 * These tests therefore can't use core's internal test-utils (they don't cross the
 * package boundary). Instead they author documents through the PUBLIC editor API
 * (`createInitialEditorState` + `reduceEditor` with `INSERT_TEXT` / `SPLIT_NODE` /
 * `SET_SELECTION` / …), rebuild the layout via `createLayoutDriver`, and drive one
 * nav keystroke through `resolveNavIntent` → `reduceEditor`.
 *
 * `nav(ctx, intent)` is the central primitive: rebuild the driver layout for the
 * current state, resolve the intent against it, and apply the resulting action (or
 * leave the state untouched when the intent is a no-op `null`). This is exactly the
 * controller's per-keystroke loop, distilled for tests.
 */
import { createInitialEditorState, createEditorStateFromState, reduceEditor, createDefaultComponentRegistry, createDefaultAttrRegistry, createMockShaper, getBlock, createPosition, createSpan, initialSelectionForState, type EditorState, type EditorConfig, type EditorAction, type Selection, type Position, type State, type BlockId, type PageConfig, type Hyphenator, type TextShaper, type ComponentRegistry, type AttrRegistry } from "@taleweaver/core";
import { type LayoutBox, type VirtualLayoutTree } from "../index";
import { createLayoutDriver, type LayoutDriver } from "../layout-driver/layout-driver";
import { resolveNavIntent, type NavIntent } from "./nav-intent";

/** The full nav-test context: the editor state + everything `nav` needs to step it. */
export interface NavCtx {
  readonly editor: EditorState;
  readonly config: EditorConfig;
  readonly driver: LayoutDriver;
  readonly measurer: TextShaper;
  readonly componentRegistry: ComponentRegistry;
  readonly attrRegistry: AttrRegistry;
  readonly containerWidth: number;
}

export interface MakeNavEditorOptions {
  readonly containerWidth?: number;
  readonly pageConfig?: PageConfig;
  readonly hyphenator?: Hyphenator;
  /** Glyph width / line-height for the mock shaper (default 8 / 16). */
  readonly charWidth?: number;
  readonly lineHeight?: number;
  /**
   * Suggesting-mode author (change-tracking). Non-null routes edits through the
   * soft-delete / suggestion path instead of a direct edit. Threaded onto the
   * reducer `EditorConfig`.
   */
  readonly suggestingAuthor?: string | null;
  /** Injected clock for undo-coalescing timing (#420). Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Build a fresh nav-test context: a default `EditorConfig` (NO measurer/hyphenator
 * — those left core in Phase 0b) + a `LayoutDriver` carrying the geometry config.
 * The component/attr registries are the SAME instances on both configs (the host
 * contract — see `LayoutConfig`'s docstring).
 */
export function makeNavEditor(opts: MakeNavEditorOptions = {}): NavCtx {
  const containerWidth = opts.containerWidth ?? 800;
  const measurer = createMockShaper(opts.charWidth ?? 8, opts.lineHeight ?? 16);
  const componentRegistry = createDefaultComponentRegistry();
  const attrRegistry = createDefaultAttrRegistry();

  const config: EditorConfig = {
    componentRegistry,
    attrRegistry,
    containerWidth,
    pageConfig: opts.pageConfig,
    suggestingAuthor: opts.suggestingAuthor,
    now: opts.now,
  };

  const driver = createLayoutDriver({
    measurer,
    hyphenator: opts.hyphenator,
    pageConfig: opts.pageConfig,
    componentRegistry,
    attrRegistry,
  });

  return {
    editor: createInitialEditorState(config),
    config,
    driver,
    measurer,
    componentRegistry,
    attrRegistry,
    containerWidth,
  };
}

/**
 * Build a nav-test context seeded from an arbitrary `State` (e.g. one produced by
 * `@taleweaver/core`'s `decodeHtml`), rather than the empty document. The initial
 * selection is the document's natural start (first content block, offset 0).
 * Everything else (config, driver, registries) matches `makeNavEditor`.
 */
export function makeNavEditorFromState(state: State, opts: MakeNavEditorOptions = {}): NavCtx {
  const containerWidth = opts.containerWidth ?? 800;
  const measurer = createMockShaper(opts.charWidth ?? 8, opts.lineHeight ?? 16);
  const componentRegistry = createDefaultComponentRegistry();
  const attrRegistry = createDefaultAttrRegistry();

  const config: EditorConfig = {
    componentRegistry,
    attrRegistry,
    containerWidth,
    pageConfig: opts.pageConfig,
  };

  const driver = createLayoutDriver({
    measurer,
    hyphenator: opts.hyphenator,
    pageConfig: opts.pageConfig,
    componentRegistry,
    attrRegistry,
  });

  return {
    editor: createEditorStateFromState(state, initialSelectionForState(state), config),
    config,
    driver,
    measurer,
    componentRegistry,
    attrRegistry,
    containerWidth,
  };
}

/** The driver-built layout tree for the context's CURRENT editor state. */
export function layoutOf(ctx: NavCtx): LayoutBox | VirtualLayoutTree {
  return ctx.driver.rebuild(ctx.editor.state, ctx.containerWidth, ctx.editor.lastDirtyIds ?? null);
}

/**
 * One nav keystroke: rebuild the driver layout for the current state, resolve
 * `intent` against it + the measurer + registry, and apply the resulting action.
 * A `null` resolution (an off-the-edge / degenerate no-op) leaves the editor
 * untouched — matching every lifted handler's `return editor;` short-circuit.
 */
export function nav(ctx: NavCtx, intent: NavIntent): NavCtx {
  const lt = layoutOf(ctx);
  const action = resolveNavIntent(intent, ctx.editor, lt, ctx.measurer, ctx.componentRegistry);
  if (action === null) return ctx;
  return { ...ctx, editor: reduceEditor(ctx.editor, action, ctx.config) };
}

/** Apply a non-nav `EditorAction` (INSERT_TEXT, SPLIT_NODE, TOGGLE_STYLE, …). */
export function dispatch(ctx: NavCtx, action: EditorAction): NavCtx {
  return { ...ctx, editor: reduceEditor(ctx.editor, action, ctx.config) };
}

/** Type a literal string one INSERT_TEXT per character (matches keystroke coalescing). */
export function typeText(ctx: NavCtx, text: string): NavCtx {
  let cur = ctx;
  for (const ch of text) {
    cur = dispatch(cur, { type: "INSERT_TEXT", text: ch });
  }
  return cur;
}

/** Insert a hard line break (Enter → SPLIT_NODE). */
export function splitBlock(ctx: NavCtx): NavCtx {
  return dispatch(ctx, { type: "SPLIT_NODE" });
}

/** Replace the selection wholesale (collapsed unless `focus` differs). */
export function setSelection(ctx: NavCtx, selection: Selection): NavCtx {
  return dispatch(ctx, { type: "SET_SELECTION", selection });
}

/** Place a collapsed caret at `(blockId, offset)` (clears any prior affinity). */
export function caretAt(ctx: NavCtx, blockId: BlockId, offset: number): NavCtx {
  const pos = createPosition(blockId, offset);
  return setSelection(ctx, createSpan(pos, pos));
}

/**
 * The first content block id of a fresh editor (the only paragraph after
 * `createInitialEditorState`). Throws on a malformed seed.
 */
export function firstBlockId(ctx: NavCtx): BlockId {
  const root = getBlock(ctx.editor.state, ctx.editor.state.rootId);
  if (root === null || root.firstChildId === null) {
    throw new Error("nav-test-helpers: editor seed has no content block");
  }
  return root.firstChildId;
}

/** The current collapsed-caret focus position. */
export function focusOf(ctx: NavCtx): Position {
  return ctx.editor.selection.focus;
}
