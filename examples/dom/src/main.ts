import {
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
  type EditorAction,
  type EditorState,
} from "@taleweaver/core";
import {
  createCanvasShaper,
  createEditorController,
} from "@taleweaver/print";

const PAGE_HEIGHT = 1056; // US Letter height at 96 DPI
const PAGE_GAP = 24;
const PAGE_WIDTH = 816; // US Letter width at 96 DPI

async function init() {
  await document.fonts.ready;

  const container = document.getElementById("editor")!;
  container.style.width = `${PAGE_WIDTH}px`;
  container.style.margin = "16px auto 48px";

  document.body.style.margin = "0";
  document.body.style.backgroundColor = "#f9fbfd";

  const canvas = document.createElement("canvas");
  // L-B / #164: pass the shaper directly; createCanvasMeasurer is a lossy
  // adapter (equal per-character widths, no cluster info).
  const shaper = createCanvasShaper(canvas);

  // Phase 0b: `measurer` LEFT core's geometry-free `EditorConfig`; the shaper is
  // built here and passed to the controller (print mechanics), not the config.
  const config: EditorConfig = {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: PAGE_WIDTH,
  };

  let editorState: EditorState = createInitialEditorState(config);

  const dispatch = (action: EditorAction) => {
    editorState = reduceEditor(editorState, action, config);
    ctrl.update(editorState);
  };

  const ctrl = createEditorController(container, {
    measurer: shaper,
    dispatch,
    pageHeight: PAGE_HEIGHT,
    pageGap: PAGE_GAP,
  });

  ctrl.update(editorState);

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.contentRect.width;
      if (width > 0) {
        dispatch({ type: "SET_CONTAINER_WIDTH", width });
      }
    }
  });
  observer.observe(container);
}

init();
