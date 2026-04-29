import { useEffect, useRef } from "react";
import { useEditor, EditorView } from "@taleweaver/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import { DocMenuBar } from "@/components/menu-bar";
import { Toolbar } from "@/components/toolbar";
import "./app.css";

// Plan 3 will re-add: pageHeight / pageMargins / pageGap for paginated layout

export function App() {
  const editor = useEditor();
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;

    // Seed the initial document with some demo content so there is visible text
    // to exercise the layout engine on first load.
    editor.dispatch({
      type: "INSERT_NODE",
      node: {
        type: "paragraph",
        properties: {},
        style: {},
        children: [
          {
            type: "text",
            properties: { content: "Welcome to Taleweaver — a document editor built with a custom layout engine." },
            style: {},
            children: [],
          },
        ],
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
        properties: {},
        style: { direction: "rtl" },
        children: [
          {
            type: "text",
            properties: { content: "שלום world עולם" },
            style: {},
            children: [],
          },
        ],
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
            <EditorView {...editor} />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
