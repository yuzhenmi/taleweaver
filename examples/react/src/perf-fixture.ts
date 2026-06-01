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
 * Implementation: a SINGLE `PASTE` of the newline-joined paragraphs. `handlePaste`
 * splits the text and chains splitBlock+insertText per line inside ONE
 * `reduceEditor` call → ONE render/cascade/layout pass over the whole document
 * (O(N)). This produces a real multi-paragraph document (identical state shape
 * to a pasted doc) and loads in O(N).
 *
 * NOTE: the prior implementation replayed N separate INSERT_TEXT/SPLIT_NODE
 * `reduceEditor` calls. Each call re-runs the per-keystroke pipeline over the
 * growing doc — O(N) per call → O(N²) to build — which froze the browser at
 * large N (e.g. perfFixture=5000 ≈ 110 pages). A single paste is O(N).
 */
export function buildPerfFixture(
  config: EditorConfig,
  paragraphCount: number,
  charsPerParagraph = 80,
): EditorState {
  const para = SAMPLE_TEXT.slice(0, charsPerParagraph);
  const text = Array.from({ length: paragraphCount }, () => para).join("\n");
  const editor = createInitialEditorState(config);
  return reduceEditor(editor, { type: "PASTE", text }, config);
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
