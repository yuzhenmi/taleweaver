import { useEditor, EditorView } from "@taleweaver/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/header";
import { DocMenuBar } from "@/components/menu-bar";
import { Toolbar } from "@/components/toolbar";
import "./app.css";

const PAGE_HEIGHT = 1056; // US Letter height at 96 DPI
const PAGE_GAP = 24;
const PAGE_MARGINS = { top: 96, bottom: 96, left: 72, right: 72 };

export function App() {
  const editor = useEditor({ pageHeight: PAGE_HEIGHT, pageMargins: PAGE_MARGINS });

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
