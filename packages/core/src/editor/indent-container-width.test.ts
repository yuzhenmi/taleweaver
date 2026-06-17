/**
 * Characterization test pinning `config.containerWidth` as a CORE editing input
 * (the #417 indent cap), NOT a geometry-only layout field.
 *
 * Phase 0b moves the render→cascade→layout geometry config out of core's
 * reducer into the `@taleweaver/print` print backend. `containerWidth` STAYS on
 * core's `EditorConfig` because the INDENT handler reads it to cap
 * `marginInlineStart` so content can't be pushed off the page (Google Docs caps
 * indent at the right margin). `indent.ts` is the SOLE non-pipeline reader of
 * `config.containerWidth` (audited 0b slice 2); this test locks the cap so the
 * field is not mistaken for geometry-only config and removed from the reducer.
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
import { MIN_INDENT_CONTENT_WIDTH } from "./actions/indent";
import { getBlock } from "../state";
import type { BlockId } from "../state";

describe("config.containerWidth is a core editing input (#417 indent cap)", () => {
  it("clamps marginInlineStart so indent can't push content off config.containerWidth", () => {
    // Narrow container → cap reached quickly: maxIndent = 200 - 96 = 104.
    const narrow = { ...config, containerWidth: 200 };
    const maxIndent = 200 - MIN_INDENT_CONTENT_WIDTH; // 104
    const initial = createInitialEditorState(narrow);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, narrow);
    const paraId = firstChildId(editor.state) as BlockId;

    // Indent well past the cap (10 × 48 = 480 ≫ 104).
    for (let i = 0; i < 10; i++) {
      editor = reduceEditor(editor, { type: "INDENT" }, narrow);
    }

    // Capped exactly at maxIndent — the cap is read from config.containerWidth,
    // so this pins containerWidth as a core editing input.
    expect(getBlock(editor.state, paraId)?.attrs.marginInlineStart).toBe(maxIndent);
  });
});
