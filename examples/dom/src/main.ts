import {
  createRegistry,
  defaultComponents,
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
  type EditorAction,
  type EditorState,
} from "@taleweaver/core";
import {
  createCanvasMeasurer,
  createEditorController,
} from "@taleweaver/dom";

const PAGE_HEIGHT = 1056; // US Letter height at 96 DPI
const PAGE_GAP = 24;
const PAGE_MARGINS = { top: 96, bottom: 96, left: 72, right: 72 };
const PAGE_WIDTH = 816; // US Letter width at 96 DPI

async function init() {
  await document.fonts.ready;

  const container = document.getElementById("editor")!;
  container.style.width = `${PAGE_WIDTH}px`;
  container.style.margin = "16px auto 48px";

  document.body.style.margin = "0";
  document.body.style.backgroundColor = "#f9fbfd";

  const canvas = document.createElement("canvas");
  const measurer = createCanvasMeasurer(canvas);
  const registry = createRegistry([...defaultComponents]);

  const config: EditorConfig = {
    measurer,
    registry,
    containerWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    pageMargins: PAGE_MARGINS,
  };

  let editorState: EditorState = createInitialEditorState(config);

  const dispatch = (action: EditorAction) => {
    editorState = reduceEditor(editorState, action, config);
    ctrl.update(editorState);
  };

  const ctrl = createEditorController(container, {
    measurer,
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
