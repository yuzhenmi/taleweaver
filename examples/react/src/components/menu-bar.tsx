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
  focus?: () => void;
}

function insertImage(dispatch: React.Dispatch<EditorAction>, focus?: () => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const maxWidth = 400;
        let width = img.naturalWidth;
        let height = img.naturalHeight;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        dispatch({
          type: "INSERT_BLOCK",
          blockType: "image",
          properties: { src, alt: file.name, width, height },
        });
        focus?.();
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

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
          <MenubarItem onSelect={() => insertImage(dispatch, focus)}>Image</MenubarItem>
          <MenubarItem onSelect={() => { dispatch({ type: "INSERT_BLOCK", blockType: "table", properties: { rows: 2, columns: 3 } }); focus?.(); }}>Table</MenubarItem>
          <MenubarItem onSelect={() => { dispatch({ type: "INSERT_BLOCK", blockType: "horizontal-line" }); focus?.(); }}>Horizontal line</MenubarItem>
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
