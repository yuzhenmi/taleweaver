import { useCallback } from "react";
import { useEditor, EditorView } from "@taleweaver/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import { DocMenuBar } from "@/components/menu-bar";
import { Toolbar } from "@/components/toolbar";
import "./app.css";

export function App() {
  const editor = useEditor();

  const handlePaperClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only handle clicks directly on the paper div (not bubbled from EditorView)
      if (e.target !== e.currentTarget) return;
      editor.containerRef.current?.focus();
      editor.dispatch({ type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" });
    },
    [editor.containerRef, editor.dispatch],
  );

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-white">
        <Header />
        <DocMenuBar dispatch={editor.dispatch} editorState={editor.editorState} />
        <Toolbar dispatch={editor.dispatch} editorState={editor.editorState} />
        <div className="flex-1 overflow-y-auto bg-[#f9fbfd]">
          <div
            className="mx-auto mt-4 mb-12 bg-white shadow-md flex flex-col cursor-text"
            style={{ width: 816, minHeight: 1056, padding: "96px 72px" }}
            onMouseDown={handlePaperClick}
          >
            <EditorView {...editor} />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
