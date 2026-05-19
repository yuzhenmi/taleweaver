/**
 * @deprecated Remove at P11.4 cutover (legacy → new direction earlier
 * in P11.3 once selection migrates; new → legacy at end of P11.4).
 *
 * Conversion helpers between legacy Position (path+offset) and new
 * Position ({blockId, offset}). Used during the P11.0+ parallel window
 * when both representations coexist on EditorState.
 *
 * Per Decision D point 6 in the P11.0 plan, signatures take the
 * corresponding state (new `State` for legacy → new, legacy `StateNode`
 * for new → legacy) for signature uniformity even when one direction
 * doesn't structurally need the state argument.
 */

import type { Position as LegacyPosition } from "../state/position";
import { createPosition as createLegacyPos } from "../state/position";
import type { Selection as LegacySelection } from "../cursor/selection";
import { createSelection } from "../cursor/selection";
import type {
  Position as NewPosition,
  Span as NewSpan,
} from "../state/block-position";
import {
  createPosition as createNewPos,
  createSpan,
} from "../state/block-position";
import type { State as NewState } from "../state/state";
import type { StateNode } from "../state/state-node-legacy";
import { pathToBlockId } from "../state/path-to-block-id";
import type { BlockId } from "../state/block-id";

/**
 * Legacy Position {path, offset} → new Position {blockId, offset}.
 * Per Decision D point 6: takes `state` for signature uniformity. The
 * body uses pathToBlockId(pos.path); the state parameter is unused.
 */
export function legacyPositionToNew(
  _state: NewState,
  pos: LegacyPosition,
): NewPosition {
  return createNewPos(pathToBlockId(pos.path), pos.offset);
}

/**
 * New Position → legacy Position. During the P11.0 parallel window all
 * ids are path-derived ("R/0/1/2"), so id-string parsing is a valid
 * shortcut. The body performs a defensive existence check against
 * `stateLegacy` — walking children[idx] for each path segment — and
 * throws if any step is missing, or if the id is not in the
 * pathToBlockId format (e.g., a post-cutover allocator UUID).
 */
export function newPositionToLegacy(
  stateLegacy: StateNode,
  pos: NewPosition,
): LegacyPosition {
  const path = parseBlockIdToPath(pos.blockId);
  // Defensive: verify path resolves to a valid node in stateLegacy.
  let node: StateNode = stateLegacy;
  for (let i = 0; i < path.length; i++) {
    const idx = path[i];
    const child = node.children[idx];
    if (child === undefined) {
      throw new Error(
        `newPositionToLegacy: path [${path.join(", ")}] does not resolve in ` +
          `stateLegacy — children[${idx}] missing at depth ${i} (blockId ` +
          `"${pos.blockId}").`,
      );
    }
    node = child;
  }
  return createLegacyPos(path, pos.offset);
}

function parseBlockIdToPath(id: BlockId): number[] {
  if (id === "R") return [];
  if (typeof id !== "string" || !id.startsWith("R/")) {
    throw new Error(
      `newPositionToLegacy: BlockId "${id}" is not in pathToBlockId format ` +
        `("R" or "R/0/1/2"). Likely a non-path-derived id (UUID from ` +
        `post-cutover allocator). The parallel-window bridge cannot ` +
        `translate this.`,
    );
  }
  const segments = id.slice(2).split("/");
  const path: number[] = [];
  for (const seg of segments) {
    const n = Number(seg);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `newPositionToLegacy: BlockId "${id}" has non-integer segment ` +
          `"${seg}".`,
      );
    }
    path.push(n);
  }
  return path;
}

/** Legacy Selection → new Span. Applies legacyPositionToNew to anchor + focus. */
export function legacySelectionToNew(
  state: NewState,
  sel: LegacySelection,
): NewSpan {
  return createSpan(
    legacyPositionToNew(state, sel.anchor),
    legacyPositionToNew(state, sel.focus),
  );
}

/** New Span → legacy Selection. Applies newPositionToLegacy to anchor + focus. */
export function newSelectionToLegacy(
  stateLegacy: StateNode,
  sel: NewSpan,
): LegacySelection {
  return createSelection(
    newPositionToLegacy(stateLegacy, sel.anchor),
    newPositionToLegacy(stateLegacy, sel.focus),
  );
}
