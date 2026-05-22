import { useEffect, useRef } from "react";
import { EditorView } from "@taleweaver/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import { DocMenuBar } from "@/components/menu-bar";
import { Toolbar } from "@/components/toolbar";
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
    editor.dispatch({
      type: "INSERT_NODE",
      node: {
        type: "paragraph",
        attrs: {},
        inlineContent: {
          items: [
            {
              kind: "text",
              text: "Welcome to Taleweaver — a document editor built with a custom layout engine.",
              attrs: {},
            },
          ],
        },
      },
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
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-white">
        <Header />
        <DocMenuBar dispatch={editor.dispatch} editorState={editor.editorState} focus={editor.focus} />
        <Toolbar dispatch={editor.dispatch} editorState={editor.editorState} />
        <div className="flex-1 overflow-y-auto bg-[#f9fbfd]">
          <div className="mx-auto mt-4 mb-12" style={{ width: 816 }}>
            <EditorView
              {...editor}
              pageHeight={PAGE_HEIGHT}
              pageGap={PAGE_GAP}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
