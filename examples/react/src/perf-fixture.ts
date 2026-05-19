import {
  createNode,
  createTextNode,
  renderTree,
  cascadePass,
  layoutTree,
  createInitialEditorState,
  type EditorState,
  type EditorConfig,
} from "@taleweaver/core";

const SAMPLE_TEXT =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.";

/**
 * Build a synthetic EditorState containing `paragraphCount` paragraphs, each
 * with a single text run of ~`charsPerParagraph` characters. The entire
 * document is laid out in one pass — no per-paragraph layout passes.
 *
 * P11.0+: the fixture overrides only the legacy representation
 * (`stateLegacy`, `renderTree`, `layoutTree`) for benchmark setup. The
 * new `state: State` and `history: History` come from a real
 * `createInitialEditorState(config)` call and will be out of sync with
 * the synthetic `stateLegacy` until the first `reduceEditor` call (which
 * triggers `rebuildStateFromLegacy` per the dual-rep gate). Acceptable
 * for perf benchmarks that exercise the legacy pipeline.
 */
export function buildPerfFixture(
  config: EditorConfig,
  paragraphCount: number,
  charsPerParagraph = 80,
): EditorState {
  const text = SAMPLE_TEXT.slice(0, charsPerParagraph);

  // nextId counter starts at 1 to mirror createInitialEditorState.
  // We allocate ids for: paragraphCount paragraph nodes + paragraphCount text
  // nodes = 2 * paragraphCount nodes.
  const paragraphs = [];
  for (let i = 0; i < paragraphCount; i++) {
    const textNode = createTextNode(`text-${i + 1}`, text);
    const paraNode = createNode(
      `paragraph-${i + 1}`,
      "paragraph",
      {},
      [textNode],
    );
    paragraphs.push(paraNode);
  }

  const docState = createNode("document", "document", {}, paragraphs);

  const rendered = renderTree(docState, config.registry);
  const cascaded = cascadePass(rendered);
  const layout = layoutTree(cascaded, config.containerWidth, config.measurer);

  // Use createInitialEditorState as the base to populate the new dual-rep
  // fields (state, history) with valid instances; override only the legacy
  // representation with synthetic content.
  const base = createInitialEditorState(config);
  return {
    ...base,
    stateLegacy: docState,
    renderTree: cascaded,
    layoutTree: layout,
    nextId: 2 * paragraphCount + 1,
  };
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
