import { useCallback } from "react";
import { useEditor, EditorView } from "@taleweaver/react";
import { resolvePositionFromPixel } from "@taleweaver/dom";
import { createCursor } from "@taleweaver/core";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import { DocMenuBar } from "@/components/menu-bar";
import { Toolbar } from "@/components/toolbar";
import "./app.css";

export function App() {
  const editor = useEditor();

  const handlePaperMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const container = editor.containerRef.current;
      if (!container) return;

      // If click is within the EditorView, let it handle the event
      if (container.contains(e.target as Node)) return;

      // Click landed on the paper outside EditorView (padding or below content).
      // Resolve position relative to the EditorView container.
      e.preventDefault();
      editor.textareaRef.current?.focus();

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const pos = resolvePositionFromPixel(
        editor.editorState.state,
        editor.editorState.layoutTree,
        editor.measurer,
        x,
        y,
      );

      if (pos) {
        editor.dispatch({
          type: "SET_SELECTION",
          selection: createCursor(pos.path, pos.offset),
        });
      } else {
        editor.dispatch({ type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" });
      }
    },
    [editor],
  );

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-white">
        <Header />
        <DocMenuBar dispatch={editor.dispatch} editorState={editor.editorState} />
        <Toolbar dispatch={editor.dispatch} editorState={editor.editorState} />
        <div className="flex-1 overflow-y-auto bg-[#f9fbfd]">
          <div
            className="mx-auto mt-4 mb-12 bg-white shadow-md cursor-text"
            style={{ width: 816, minHeight: 1056, padding: "96px 72px" }}
            onMouseDown={handlePaperMouseDown}
          >
            <EditorView {...editor} />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
