import { useEditor, EditorView } from "@taleweaver/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import { DocMenuBar } from "@/components/menu-bar";
import { Toolbar } from "@/components/toolbar";
import "./app.css";

// Plan 3 will re-add: pageHeight / pageMargins / pageGap for paginated layout

export function App() {
  const editor = useEditor();

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
