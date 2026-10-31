/**
 * Characterization test pinning the container width as a CORE editing input
 * (the #417 indent cap), NOT a geometry-only layout field.
 *
 * Phase 0b moves the render→cascade→layout geometry config out of core's
 * reducer into the `@taleweaver/print` print backend. `containerWidth` STAYS on
 * core's `EditorState` because the INDENT handler reads it to cap
 * `marginInlineStart` so content can't be pushed off the page (Google Docs caps
 * indent at the right margin). The cap reads the LIVE `editor.containerWidth`
 * (kept current by `SET_CONTAINER_WIDTH`), not the initial
 * `config.containerWidth`; this test locks both.
 *
 * Mirrors the assertion shape of the #417 cap test in
 * `actions/indent.test.ts` ("INDENT caps at containerWidth -
 * MIN_INDENT_CONTENT_WIDTH").
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
  firstChildId,
} from "./actions/test-helpers";
import { MIN_INDENT_CONTENT_WIDTH } from "./actions/helpers/shift-indent";
import { getBlock } from "../state";
import type { BlockId } from "../state";

describe("containerWidth is a core editing input (#417 indent cap)", () => {
  it("clamps marginInlineStart so indent can't push content off the live containerWidth", () => {
    // Built wide, then resized narrow → the cap follows the resize: maxIndent = 200 - 96 = 104.
    const initial = createInitialEditorState({ ...config, containerWidth: 1000 });
    const maxIndent = 200 - MIN_INDENT_CONTENT_WIDTH; // 104
    let editor = reduceEditor(initial, { type: "SET_CONTAINER_WIDTH", width: 200 });
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "hi" });
    const paraId = firstChildId(editor.document) as BlockId;

    // Indent well past the cap (10 × 48 = 480 ≫ 104).
    for (let i = 0; i < 10; i++) {
      editor = reduceEditor(editor, { type: "INDENT" });
    }

    // Capped exactly at maxIndent — read from the resized width, not the initial config's.
    expect(getBlock(editor.document, paraId)?.attrs.marginInlineStart).toBe(maxIndent);
  });
});
