import { useEffect, useRef, useState } from "react";
import { EditorView, type EditorViewHandle } from "@taleweaver/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import { DocMenuBar } from "@/components/menu-bar";
import { Toolbar } from "@/components/toolbar";
import { FindBar } from "@/components/find-bar";
import { usePerfEditor } from "./use-perf-editor";
import { setPerfTraceEnabled, report, resetPerfTrace } from "@taleweaver/core";
import "./app.css";

const PAGE_HEIGHT = 1056;            // US Letter at 96 DPI
const PAGE_GAP = 24;

export function App() {
  // usePerfEditor mirrors useEditor but also checks ?perfFixture=N on mount
  // and initializes the editor with a synthetic N-paragraph document when set.
  const editor = usePerfEditor();
  const seededRef = useRef(false);

  // Imperative handle into the EditorView's controller (#433): the find-bar
  // drives find/replace through it without reaching into the controller.
  const viewRef = useRef<EditorViewHandle>(null);
  // null when the find-bar is hidden; otherwise its mode (Ctrl+F vs Ctrl+H).
  const [findMode, setFindMode] = useState<null | "find" | "replace">(null);

  // Ctrl/Cmd+F → find; Ctrl/Cmd+H → replace. preventDefault overrides the
  // browser's native find/replace so our in-document bar takes over. Escape is
  // handled inside the bar (it has the focus while open).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "f") {
        e.preventDefault();
        setFindMode("find");
      } else if (key === "h") {
        e.preventDefault();
        setFindMode("replace");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // When a perf fixture is active: enable tracing and expose dev console hooks.
  useEffect(() => {
    if (!editor.isPerfFixture) return;
    setPerfTraceEnabled(true);
    (window as unknown as { __perfReport: () => unknown; __perfReset: () => void }).__perfReport = () => {
      const r = report();
      console.table(r.entries);
      return r;
    };
    (window as unknown as { __perfReset: () => void }).__perfReset = () => {
      resetPerfTrace();
      console.log("Perf trace reset");
    };
  }, [editor.isPerfFixture]);

  useEffect(() => {
    // Skip default seeding when a perf fixture is already loaded via URL.
    if (seededRef.current || editor.isPerfFixture) return;
    seededRef.current = true;

    // Seed the initial document with some demo content so there is visible text
    // to exercise the layout engine on first load.
    //
    // createEmptyDocument seeds the doc with a single empty paragraph and the
    // initial cursor sits inside it. We INSERT_TEXT into that existing empty
    // paragraph rather than appending a new one — otherwise the empty
    // paragraph remains as a tiny invisible line above the seeded content,
    // and the cursor lands there on first load.
    editor.dispatch({
      type: "INSERT_TEXT",
      text: "Welcome to Taleweaver — a document editor built with a custom layout engine.",
    });

    // RTL smoke-test paragraph: Hebrew + Latin mixed text, direction rtl.
    // The canvas shaper shapes each run independently; bidi reordering within
    // a mixed-direction run is not yet implemented (reserved for Plan 4), so
    // Latin words inside the Hebrew text render LTR within their shaped run.
    // The paragraph itself is right-aligned due to direction: "rtl".
    editor.dispatch({
      type: "INSERT_NODE",
      node: {
        type: "paragraph",
        attrs: { direction: "rtl" },
        inlineContent: {
          items: [
            {
              kind: "text",
              text: "שלום world עולם",
              attrs: {},
            },
          ],
        },
      },
    });

    // Move cursor to the very start of the document. INSERT_TEXT leaves the
    // cursor at the END of the inserted text (offset 76 of the welcome
    // paragraph) — landing the cursor there on first paint isn't useful for
    // a fresh editor. Put the cursor at offset 0 so a fresh user sees it at
    // the document start.
    editor.dispatch({
      type: "MOVE_DOCUMENT_BOUNDARY",
      boundary: "start",
    });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-white">
        <Header />
        <DocMenuBar dispatch={editor.dispatch} editorState={editor.editorState} focus={editor.focus} />
        <Toolbar dispatch={editor.dispatch} editorState={editor.editorState} />
        <div className="relative flex-1 overflow-y-auto bg-[#f9fbfd]">
          {findMode && viewRef.current && (
            <FindBar
              handle={viewRef.current}
              mode={findMode}
              editorState={editor.editorState}
              onClose={() => {
                setFindMode(null);
                editor.focus();
              }}
            />
          )}
          <div className="mx-auto mt-4 mb-12" style={{ width: 816 }}>
            <EditorView
              {...editor}
              ref={viewRef}
              pageHeight={PAGE_HEIGHT}
              pageGap={PAGE_GAP}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
