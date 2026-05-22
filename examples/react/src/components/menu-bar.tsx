import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";
import type { EditorAction, EditorState } from "@taleweaver/dom";
import type { BlockInit } from "@taleweaver/core";

// Minimal paragraph factory. Builds a BlockInit for a paragraph block with
// no inlineContent (empty paragraph). `INSERT_NODE` validates the shape
// against `blockKindOf("paragraph") === "inline-bearing-leaf"`.
function createParagraph(): BlockInit {
  return { type: "paragraph", attrs: {}, inlineContent: { items: [] } };
}

interface DocMenuBarProps {
  dispatch: React.Dispatch<EditorAction>;
  editorState: EditorState;
  focus?: () => void;
}

// Plan 2 will re-add: insertImage (INSERT_NODE with image factory)
// Plan 2 will re-add: table insertion (INSERT_NODE with table factory)
// Plan 2 will re-add: horizontal-line insertion (INSERT_NODE with hr factory)

export function DocMenuBar({ dispatch, focus }: DocMenuBarProps) {
  return (
    <Menubar className="rounded-none border-x-0 border-t-0 border-b border-[#dadce0] bg-white px-2 shadow-none h-8">
      <MenubarMenu>
        <MenubarTrigger className="text-sm font-normal px-2 py-0.5">File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem disabled>New <MenubarShortcut>Ctrl+N</MenubarShortcut></MenubarItem>
          <MenubarItem disabled>Open <MenubarShortcut>Ctrl+O</MenubarShortcut></MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled>Save <MenubarShortcut>Ctrl+S</MenubarShortcut></MenubarItem>
          <MenubarItem disabled>Download</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="text-sm font-normal px-2 py-0.5">Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={() => { dispatch({ type: "UNDO" }); focus?.(); }}>
            Undo <MenubarShortcut>Ctrl+Z</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => { dispatch({ type: "REDO" }); focus?.(); }}>
            Redo <MenubarShortcut>Ctrl+Y</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => { dispatch({ type: "SELECT_ALL" }); focus?.(); }}>
            Select all <MenubarShortcut>Ctrl+A</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="text-sm font-normal px-2 py-0.5">View</MenubarTrigger>
        <MenubarContent>
          <MenubarItem disabled>Print layout</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="text-sm font-normal px-2 py-0.5">Insert</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={() => { dispatch({ type: "INSERT_NODE", node: createParagraph() }); focus?.(); }}>
            Paragraph
          </MenubarItem>
          {/* Plan 2 will re-add: Image, Table, Horizontal line */}
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="text-sm font-normal px-2 py-0.5">Format</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={() => { dispatch({ type: "TOGGLE_STYLE", style: "bold" }); focus?.(); }}>
            Bold <MenubarShortcut>Ctrl+B</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => { dispatch({ type: "TOGGLE_STYLE", style: "italic" }); focus?.(); }}>
            Italic <MenubarShortcut>Ctrl+I</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => { dispatch({ type: "TOGGLE_STYLE", style: "underline" }); focus?.(); }}>
            Underline <MenubarShortcut>Ctrl+U</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}
