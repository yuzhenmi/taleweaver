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

interface DocMenuBarProps {
  dispatch: React.Dispatch<EditorAction>;
  editorState: EditorState;
}

export function DocMenuBar({ dispatch }: DocMenuBarProps) {
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
          <MenubarItem onSelect={() => dispatch({ type: "UNDO" })}>
            Undo <MenubarShortcut>Ctrl+Z</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => dispatch({ type: "REDO" })}>
            Redo <MenubarShortcut>Ctrl+Y</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => dispatch({ type: "SELECT_ALL" })}>
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
          <MenubarItem disabled>Image</MenubarItem>
          <MenubarItem disabled>Table</MenubarItem>
          <MenubarItem disabled>Horizontal line</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className="text-sm font-normal px-2 py-0.5">Format</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={() => dispatch({ type: "TOGGLE_STYLE", style: "bold" })}>
            Bold <MenubarShortcut>Ctrl+B</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => dispatch({ type: "TOGGLE_STYLE", style: "italic" })}>
            Italic <MenubarShortcut>Ctrl+I</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => dispatch({ type: "TOGGLE_STYLE", style: "underline" })}>
            Underline <MenubarShortcut>Ctrl+U</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}
