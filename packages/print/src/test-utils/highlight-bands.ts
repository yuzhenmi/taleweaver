import {
  FIND_HIGHLIGHT_FILL,
  ACTIVE_FIND_HIGHLIGHT_FILL,
  COMMENT_HIGHLIGHT_FILL,
  ACTIVE_COMMENT_HIGHLIGHT_FILL,
  SUGGESTION_HIGHLIGHT_FILL,
  ACTIVE_SUGGESTION_HIGHLIGHT_FILL,
  asBlockId,
  createPosition,
} from "@taleweaver/core";
import type { SelectionRect } from "../cursor/selection-geometry";
import type { DecorationRect } from "../decoration-geometry";

/** A renderer-level test band: a rect + whether it is the active (emphasized) one. */
export type TestBand = SelectionRect & { active: boolean };

function band(id: string, fill: string, activeFill: string) {
  return (r: TestBand): DecorationRect => ({
    x: r.x, y: r.y, width: r.width, height: r.height, pageIndex: r.pageIndex,
    kind: "inline",
    decoration: { kind: "inline", id, from: createPosition(asBlockId("b"), 0), to: createPosition(asBlockId("b"), 1) },
    vertical: false,
    backgroundColor: r.active ? activeFill : fill,
  });
}

/** Built-in highlight fragments as the controller emits them (core's fills). */
export const findBand = band("tw-find:0", FIND_HIGHLIGHT_FILL, ACTIVE_FIND_HIGHLIGHT_FILL);
export const commentBand = band("tw-comment:c", COMMENT_HIGHLIGHT_FILL, ACTIVE_COMMENT_HIGHLIGHT_FILL);
export const suggestionBand = band("tw-suggestion:s", SUGGESTION_HIGHLIGHT_FILL, ACTIVE_SUGGESTION_HIGHLIGHT_FILL);
