import {
  createInitialEditorState,
  reduceEditor,
  type EditorState,
  type EditorConfig,
} from "@taleweaver/core";

const SAMPLE_TEXT =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.";

/**
 * Build a synthetic EditorState containing `paragraphCount` paragraphs, each
 * with a single text run of ~`charsPerParagraph` characters.
 *
 * Implementation: starts from an empty editor (one paragraph) and replays
 * INSERT_TEXT / SPLIT_NODE actions to grow the document. This goes through
 * the full Y.Doc + history pipeline, so the perf-fixture state shape is
 * identical to a real edited document. Not the fastest possible builder,
 * but accurate.
 */
export function buildPerfFixture(
  config: EditorConfig,
  paragraphCount: number,
  charsPerParagraph = 80,
): EditorState {
  const text = SAMPLE_TEXT.slice(0, charsPerParagraph);
  let editor = createInitialEditorState(config);
  for (let i = 0; i < paragraphCount; i++) {
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text }, config);
    if (i < paragraphCount - 1) {
      editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    }
  }
  return editor;
}

/**
 * Read `?perfFixture=N` from the current URL. Returns an `EditorState` with
 * N paragraphs if the param is present and valid; otherwise returns `null`.
 */
export function tryLoadPerfFixtureFromUrl(
  config: EditorConfig,
): EditorState | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("perfFixture");
  if (raw === null) return null;
  const count = parseInt(raw, 10);
  if (Number.isNaN(count) || count <= 0) return null;
  return buildPerfFixture(config, count);
}
