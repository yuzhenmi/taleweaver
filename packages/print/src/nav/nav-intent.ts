import {
  createSpan,
  createPosition,
  spanStart,
  spanEnd,
  isCollapsed,
  isObjectSelection,
  objectMoveSelection,
  isCrossContextSelection,
  expandedSpanCollapsePoint,
  moveByCharacter,
  expandSelection,
  seedAnchorAffinity,
  isTextShaper,
  adaptShaperToMeasurer,
  type EditorState,
  type EditorAction,
  type Position,
  type CaretAffinity,
  type TextShaper,
  type TextMeasurer,
  type ComponentRegistry,
} from "@taleweaver/core";
import { moveToLine, moveToLineBoundary } from "../cursor/line-navigation";
import { resolveLineForPosition, buildBlockGraphemeStepper } from "../cursor/visual-motion";
import { buildLineBidiView, moveVisually } from "../cursor/line-bidi";
import type { LayoutBox } from "../layout/layout-node";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";

/**
 * The geometric-navigation INTENTS the print backend owns (Phase 0b). Core's
 * reducer is geometry-free: it has NO MOVE_CURSOR / MOVE_LINE / EXPAND_* /
 * DELETE_LINE actions. Instead the controller maps the keystroke to one of these
 * `NavIntent`s, the backend's `resolveNavIntent` reads the driver-built
 * `layoutTree` + measurer to compute the geometry, and dispatches a geometry-free
 * `SET_SELECTION` / `DELETE_RANGE` back to core (which owns the document edit).
 *
 * The seven variants are EXACTLY the seven core handlers that were lifted out:
 * MOVE_CURSOR / EXPAND_SELECTION (visual-order ±1 grapheme), MOVE_LINE /
 * EXPAND_LINE (vertical line-move, sticky `targetX`), MOVE_LINE_BOUNDARY /
 * EXPAND_LINE_BOUNDARY (Home/End), and DELETE_LINE (Cmd+Backspace → line span).
 */
export type NavIntent =
  | { type: "MOVE_CURSOR"; direction: "forward" | "backward" }
  | { type: "EXPAND_SELECTION"; direction: "forward" | "backward" }
  | { type: "MOVE_LINE"; direction: "up" | "down" }
  | { type: "EXPAND_LINE"; direction: "up" | "down" }
  | { type: "MOVE_LINE_BOUNDARY"; boundary: "start" | "end" }
  | { type: "EXPAND_LINE_BOUNDARY"; boundary: "start" | "end" }
  | { type: "DELETE_LINE" };

/**
 * Resolve a `NavIntent` to the geometry-free `EditorAction` core should run, or
 * `null` when the intent is a no-op (a line-move off the document edge, a
 * defensive null line, an object-nav at a boundary, a degenerate line-delete).
 * `null` means "dispatch nothing" — matching every lifted handler's `return
 * editor;` short-circuit.
 *
 * This is a relocation of the seven core nav handlers' bodies, reading the
 * driver-built `layoutTree` + `measurer` instead of `editor.layoutTree` /
 * `config.measurer`, and RETURNING a `SET_SELECTION` / `DELETE_RANGE` (threading
 * both affinities + `targetX`) rather than mutating `EditorState`. Behavior is
 * byte-for-byte identical to the lifted handlers.
 */
export function resolveNavIntent(
  intent: NavIntent,
  editor: EditorState,
  layoutTree: LayoutBox | VirtualLayoutTree,
  measurer: TextShaper | TextMeasurer,
  componentRegistry: ComponentRegistry,
): EditorAction | null {
  switch (intent.type) {
    case "MOVE_CURSOR":
      return resolveMoveCursor(editor, intent.direction, layoutTree, measurer, componentRegistry);
    case "EXPAND_SELECTION":
      return resolveExpandSelection(editor, intent.direction, layoutTree, measurer);
    case "MOVE_LINE":
      return resolveMoveLine(editor, intent.direction, layoutTree, measurer, componentRegistry);
    case "EXPAND_LINE":
      return resolveExpandLine(editor, intent.direction, layoutTree, measurer);
    case "MOVE_LINE_BOUNDARY":
      return resolveMoveLineBoundary(editor, intent.boundary, layoutTree, measurer);
    case "EXPAND_LINE_BOUNDARY":
      return resolveExpandLineBoundary(editor, intent.boundary, layoutTree, measurer);
    case "DELETE_LINE":
      return resolveDeleteLine(editor, layoutTree, measurer, componentRegistry);
    default: {
      intent satisfies never;
      return null;
    }
  }
}

/** A collapsed `SET_SELECTION` to a single caret, with affinities/targetX threaded. */
function setCaret(
  caret: Position,
  caretAffinity: CaretAffinity | undefined,
  targetX: number | null,
): EditorAction {
  return {
    type: "SET_SELECTION",
    selection: createSpan(caret, caret),
    caretAffinity,
    anchorAffinity: undefined,
    targetX,
  };
}

function toMeasurer(measurer: TextShaper | TextMeasurer): TextMeasurer {
  return isTextShaper(measurer) ? adaptShaperToMeasurer(measurer) : measurer;
}

// ── MOVE_CURSOR (was move-cursor.ts) ───────────────────────────────────────

function resolveMoveCursor(
  editor: EditorState,
  direction: "forward" | "backward",
  layoutTree: LayoutBox | VirtualLayoutTree,
  measurer: TextShaper | TextMeasurer,
  componentRegistry: ComponentRegistry,
): EditorAction | null {
  const { selection } = editor;

  const objId = isObjectSelection(editor.state, selection, componentRegistry);
  if (objId !== null) {
    const sel = objectMoveSelection(editor.state, objId, direction);
    return sel === null ? null : { type: "SET_SELECTION", selection: sel, targetX: null };
  }

  const visualDir = direction === "forward" ? "right" : "left";

  if (!isCollapsed(selection)) {
    const pos =
      direction === "forward"
        ? spanEnd(editor.state, selection)
        : spanStart(editor.state, selection);
    return setCaret(pos, undefined, null);
  }

  const line = resolveLineForPosition(
    editor.state,
    selection.focus,
    layoutTree,
    toMeasurer(measurer),
    editor.caretPageHint,
    editor.caretAffinity,
  );
  if (line === null) {
    const newFocus = moveByCharacter(editor.state, selection.focus, direction);
    return setCaret(newFocus, undefined, null);
  }

  const view = buildLineBidiView(line);
  const step = buildBlockGraphemeStepper(editor.state, selection.focus.blockId);
  const result = moveVisually(view, selection.focus.offset, editor.caretAffinity, visualDir, step);

  if ("exit" in result) {
    const newFocus = moveByCharacter(editor.state, selection.focus, result.exitLogicalDir);
    return setCaret(newFocus, undefined, null);
  }

  const newFocus: Position = { blockId: selection.focus.blockId, offset: result.offset };
  return setCaret(newFocus, result.caretAffinity, null);
}

// ── EXPAND_SELECTION (was expand-selection.ts) ─────────────────────────────

function resolveExpandSelection(
  editor: EditorState,
  direction: "forward" | "backward",
  layoutTree: LayoutBox | VirtualLayoutTree,
  measurer: TextShaper | TextMeasurer,
): EditorAction | null {
  const { selection } = editor;
  const visualDir = direction === "forward" ? "right" : "left";
  const newAnchorAffinity = seedAnchorAffinity(editor);

  const line = resolveLineForPosition(
    editor.state,
    selection.focus,
    layoutTree,
    toMeasurer(measurer),
    editor.caretPageHint,
    editor.caretAffinity,
  );
  if (line === null) {
    return logicalExtend(editor, direction, undefined);
  }

  const view = buildLineBidiView(line);
  const step = buildBlockGraphemeStepper(editor.state, selection.focus.blockId);
  const result = moveVisually(view, selection.focus.offset, editor.caretAffinity, visualDir, step);

  if ("exit" in result) {
    return logicalExtend(editor, result.exitLogicalDir, newAnchorAffinity);
  }

  const newFocus: Position = { blockId: selection.focus.blockId, offset: result.offset };
  return {
    type: "SET_SELECTION",
    selection: createSpan(selection.anchor, newFocus),
    caretAffinity: result.caretAffinity,
    anchorAffinity: newAnchorAffinity,
    targetX: null,
  };
}

function logicalExtend(
  editor: EditorState,
  direction: "forward" | "backward",
  newAnchorAffinity: CaretAffinity | undefined,
): EditorAction {
  const newSelection = expandSelection(editor.state, editor.selection, direction);
  return {
    type: "SET_SELECTION",
    selection: newSelection,
    caretAffinity: undefined,
    anchorAffinity: newAnchorAffinity,
    targetX: null,
  };
}

// ── MOVE_LINE (was move-line.ts) ───────────────────────────────────────────

function resolveMoveLine(
  editor: EditorState,
  direction: "up" | "down",
  layoutTree: LayoutBox | VirtualLayoutTree,
  measurer: TextShaper | TextMeasurer,
  componentRegistry: ComponentRegistry,
): EditorAction | null {
  const { selection } = editor;

  const objId = isObjectSelection(editor.state, selection, componentRegistry);
  if (objId !== null) {
    const sel = objectMoveSelection(editor.state, objId, direction === "up" ? "backward" : "forward");
    return sel === null ? null : { type: "SET_SELECTION", selection: sel, targetX: null };
  }

  const moveFocus = isCollapsed(selection)
    ? selection.focus
    : direction === "up"
      ? spanStart(editor.state, selection)
      : spanEnd(editor.state, selection);

  const result = moveToLine(
    editor.state,
    moveFocus,
    layoutTree,
    measurer,
    direction,
    editor.targetX,
    editor.caretPageHint,
  );
  if (result === null) return null;
  return setCaret(result.position, result.caretAffinity, result.targetX);
}

// ── EXPAND_LINE (was expand-line.ts) ───────────────────────────────────────

function resolveExpandLine(
  editor: EditorState,
  direction: "up" | "down",
  layoutTree: LayoutBox | VirtualLayoutTree,
  measurer: TextShaper | TextMeasurer,
): EditorAction | null {
  const newAnchorAffinity = seedAnchorAffinity(editor);
  const result = moveToLine(
    editor.state,
    editor.selection.focus,
    layoutTree,
    measurer,
    direction,
    editor.targetX,
    editor.caretPageHint,
  );
  if (result === null) return null;
  return {
    type: "SET_SELECTION",
    selection: createSpan(editor.selection.anchor, result.position),
    caretAffinity: result.caretAffinity,
    anchorAffinity: newAnchorAffinity,
    targetX: result.targetX,
  };
}

// ── MOVE_LINE_BOUNDARY (was move-line-boundary.ts) ─────────────────────────

function resolveMoveLineBoundary(
  editor: EditorState,
  boundary: "start" | "end",
  layoutTree: LayoutBox | VirtualLayoutTree,
  measurer: TextShaper | TextMeasurer,
): EditorAction | null {
  const pos = moveToLineBoundary(
    editor.state,
    editor.selection.focus,
    layoutTree,
    measurer,
    boundary,
    editor.caretPageHint,
  );
  if (pos === null) return null;
  const caretAffinity: CaretAffinity = boundary === "start" ? "after" : "before";
  return setCaret(pos, caretAffinity, null);
}

// ── EXPAND_LINE_BOUNDARY (was expand-line-boundary.ts) ─────────────────────

function resolveExpandLineBoundary(
  editor: EditorState,
  boundary: "start" | "end",
  layoutTree: LayoutBox | VirtualLayoutTree,
  measurer: TextShaper | TextMeasurer,
): EditorAction | null {
  const newAnchorAffinity = seedAnchorAffinity(editor);
  const pos = moveToLineBoundary(
    editor.state,
    editor.selection.focus,
    layoutTree,
    measurer,
    boundary,
    editor.caretPageHint,
  );
  if (pos === null) return null;
  const caretAffinity: CaretAffinity = boundary === "start" ? "after" : "before";
  return {
    type: "SET_SELECTION",
    selection: createSpan(editor.selection.anchor, pos),
    caretAffinity,
    anchorAffinity: newAnchorAffinity,
    targetX: null,
  };
}

// ── DELETE_LINE (was delete-line.ts collapsed branch) ──────────────────────

function resolveDeleteLine(
  editor: EditorState,
  layoutTree: LayoutBox | VirtualLayoutTree,
  measurer: TextShaper | TextMeasurer,
  componentRegistry: ComponentRegistry,
): EditorAction | null {
  const { selection } = editor;

  // Object selection: delete-to-line-start on a selected atomic-leaf is a no-op.
  if (isObjectSelection(editor.state, selection, componentRegistry) !== null) {
    return null;
  }

  if (!isCollapsed(selection)) {
    // A non-collapsed selection deletes the selection via the same context-aware
    // guards the lifted handler used; core's DELETE_RANGE normalizes + commits.
    if (isCrossContextSelection(editor.state, selection)) return null;
    const start = expandedSpanCollapsePoint(editor.state, selection);
    if (start === null) return null;
    return { type: "DELETE_RANGE", span: selection };
  }

  const pos = selection.focus;
  const lineStart = moveToLineBoundary(editor.state, pos, layoutTree, measurer, "start");
  if (lineStart === null) return null;
  if (lineStart.blockId === pos.blockId && lineStart.offset === pos.offset) return null;
  // Only within-block line deletion (line boundaries stay inside one block).
  if (lineStart.blockId !== pos.blockId) return null;

  const span = createSpan(createPosition(lineStart.blockId, lineStart.offset), pos);
  return { type: "DELETE_RANGE", span };
}
