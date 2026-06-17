import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar";
import type { EditorAction, EditorState } from "@taleweaver/print";
import type { BlockInit, TextTransform } from "@taleweaver/core";
import { getActiveFormatting } from "@taleweaver/core";

// Capitalization (CSS text-transform) options for the Format ▸ Capitalization
// submenu. The labels SHOW the visual effect; the `value` is the CSS
// `text-transform` literal dispatched via SET_TEXT_TRANSFORM. Typed as
// `TextTransform` so the dispatched `value` matches the action union exactly.
const TEXT_TRANSFORM_OPTIONS: ReadonlyArray<{ value: TextTransform; label: string }> = [
  { value: "none", label: "None" },
  { value: "uppercase", label: "UPPERCASE" },
  { value: "lowercase", label: "lowercase" },
  { value: "capitalize", label: "Capitalize Each Word" },
];

// Minimal paragraph factory. Builds a BlockInit for a paragraph block with
// no inlineContent (empty paragraph). `INSERT_NODE` validates the shape via
// the component registry (paragraph's `leafShape: "inline-bearing"` maps to
// `BlockKind "inline-bearing-leaf"`).
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

export function DocMenuBar({ dispatch, editorState, focus }: DocMenuBarProps) {
  // Active capitalization at the selection. `getActiveFormatting().textTransform`
  // returns the inline `textTransform` value, `null` when unset (which IS the
  // default — "none"), or `"mixed"` across a multi-value selection. The radio
  // group's `value` drives the checkmark: map `null` → "none" (the default item
  // is active when nothing overrides it), and `"mixed"` → "" so NO item shows
  // active.
  const activeTextTransform = getActiveFormatting(
    editorState.state,
    editorState.selection,
  ).textTransform;
  const textTransformValue =
    activeTextTransform === "mixed"
      ? ""
      : activeTextTransform ?? "none";
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
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>Capitalization</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarRadioGroup
                value={textTransformValue}
                onValueChange={(next) => {
                  const option = TEXT_TRANSFORM_OPTIONS.find((o) => o.value === next);
                  if (!option) return;
                  dispatch({ type: "SET_TEXT_TRANSFORM", value: option.value });
                  focus?.();
                }}
              >
                {TEXT_TRANSFORM_OPTIONS.map((option) => (
                  <MenubarRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </MenubarRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}
