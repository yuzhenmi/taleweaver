import { useMemo } from "react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Undo2,
  Redo2,
  List,
  ListOrdered,
  ChevronDown,
  SeparatorHorizontal,
  RectangleHorizontal,
  PanelTop,
  PanelBottom,
  Superscript,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  IndentIncrease,
  IndentDecrease,
  Baseline,
  Highlighter,
  Ban,
  RemoveFormatting,
} from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EditorAction, EditorState, FootnoteNumberingPolicy } from "@taleweaver/dom";
import { documentFootnotePolicy } from "@taleweaver/dom";
import { getFormatState } from "./toolbar-utils";

interface ToolbarProps {
  dispatch: React.Dispatch<EditorAction>;
  editorState: EditorState;
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  paragraph: "Normal text",
  "heading-1": "Heading 1",
  "heading-2": "Heading 2",
  "heading-3": "Heading 3",
};

function getBlockTypeLabel(blockType: string, headingLevel: number | null): string {
  if (blockType === "heading" && headingLevel) {
    return BLOCK_TYPE_LABELS[`heading-${headingLevel}`] ?? "Heading";
  }
  return BLOCK_TYPE_LABELS[blockType] ?? "Normal text";
}

function ToolbarButton({
  label,
  icon: Icon,
  disabled,
  onAction,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  onAction: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-sm text-[#444746] hover:bg-[#d3e3fd] disabled:opacity-40"
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            onAction();
          }}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolbarToggle({
  label,
  icon: Icon,
  pressed,
  onAction,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  pressed: boolean;
  onAction: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={pressed}
          className="h-7 w-7 rounded-sm text-[#444746] hover:bg-[#d3e3fd] data-[state=on]:bg-[#d3e3fd] data-[state=on]:text-[#1a73e8]"
          onMouseDown={(e) => {
            e.preventDefault();
            onAction();
          }}
        >
          <Icon className="h-4 w-4" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function Toolbar({ dispatch, editorState }: ToolbarProps) {
  const fmt = useMemo(() => getFormatState(editorState), [editorState]);
  const blockLabel = getBlockTypeLabel(fmt.blockType, fmt.headingLevel);
  // Current document-wide footnote numbering reset policy (drives the select's
  // controlled value below). Read straight from the root block's attrs.
  const footnoteReset = useMemo(
    () => documentFootnotePolicy(editorState.state).reset,
    [editorState],
  );

  return (
    <div className="flex items-center gap-0.5 px-3 py-1 bg-[#edf2fa] mx-3 mt-1 mb-0 rounded-full border border-[#dadce0]">
      {/* Undo / Redo */}
      <ToolbarButton
        label="Undo (Ctrl+Z)"
        icon={Undo2}
        disabled={!fmt.canUndo}
        onAction={() => dispatch({ type: "UNDO" })}
      />
      <ToolbarButton
        label="Redo (Ctrl+Y)"
        icon={Redo2}
        disabled={!fmt.canRedo}
        onAction={() => dispatch({ type: "REDO" })}
      />

      <Separator orientation="vertical" className="mx-1 h-5 bg-[#c4c7c5]" />

      {/* Block type dropdown */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-7 px-2 rounded-sm text-[#444746] hover:bg-[#d3e3fd] text-sm font-normal gap-1"
                onMouseDown={(e) => e.preventDefault()}
              >
                {blockLabel}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Styles
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() => dispatch({ type: "SET_BLOCK_TYPE", blockType: "paragraph" })}
          >
            <span className="text-sm">Normal text</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() => dispatch({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } })}
          >
            <span className="text-2xl font-bold">Heading 1</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() => dispatch({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } })}
          >
            <span className="text-xl font-bold">Heading 2</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() => dispatch({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 3 } })}
          >
            <span className="text-lg font-bold">Heading 3</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-1 h-5 bg-[#c4c7c5]" />

      {/* Bold / Italic / Underline */}
      <ToolbarToggle
        label="Bold (Ctrl+B)"
        icon={Bold}
        pressed={fmt.bold}
        onAction={() => dispatch({ type: "TOGGLE_STYLE", style: "bold" })}
      />
      <ToolbarToggle
        label="Italic (Ctrl+I)"
        icon={Italic}
        pressed={fmt.italic}
        onAction={() => dispatch({ type: "TOGGLE_STYLE", style: "italic" })}
      />
      <ToolbarToggle
        label="Underline (Ctrl+U)"
        icon={Underline}
        pressed={fmt.underline}
        onAction={() => dispatch({ type: "TOGGLE_STYLE", style: "underline" })}
      />
      <ToolbarToggle
        label="Strikethrough (Ctrl+Shift+X)"
        icon={Strikethrough}
        pressed={fmt.strikethrough}
        onAction={() =>
          dispatch({ type: "TOGGLE_STYLE", style: "strikethrough" })
        }
      />

      {/* Text color. A native <input type="color"> is a complete color
          picker; its onChange dispatches SET_TEXT_COLOR with the chosen
          hex, which sets the per-run `color` attr (cascade →
          ComputedStyle.color → glyph fillStyle). The adjacent reset button
          clears the attr (color: null) so the text falls back to the
          inherited/default color. onMouseDown/preventDefault on the wrappers
          keeps the editor's selection while interacting. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <label
            className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm text-[#444746] hover:bg-[#d3e3fd]"
            onMouseDown={(e) => e.preventDefault()}
          >
            <Baseline className="h-4 w-4" />
            <input
              type="color"
              aria-label="Text color"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              onMouseDown={(e) => e.preventDefault()}
              onChange={(e) =>
                dispatch({ type: "SET_TEXT_COLOR", color: e.target.value })
              }
            />
          </label>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Text color
        </TooltipContent>
      </Tooltip>
      <ToolbarButton
        label="Reset text color"
        icon={Ban}
        onAction={() => dispatch({ type: "SET_TEXT_COLOR", color: null })}
      />

      {/* Highlight color (text background color). The sibling of the text-color
          control above: its onChange dispatches SET_HIGHLIGHT with the chosen
          hex, which sets the per-run `backgroundColor` attr (cascade →
          ComputedStyle.backgroundColor → a rect painted behind the glyphs). The
          adjacent reset button clears the attr (color: null) so the text falls
          back to a transparent background. onMouseDown/preventDefault on the
          wrappers keeps the editor's selection while interacting. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <label
            className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm text-[#444746] hover:bg-[#d3e3fd]"
            onMouseDown={(e) => e.preventDefault()}
          >
            <Highlighter className="h-4 w-4" />
            <input
              type="color"
              aria-label="Highlight color"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              onMouseDown={(e) => e.preventDefault()}
              onChange={(e) =>
                dispatch({ type: "SET_HIGHLIGHT", color: e.target.value })
              }
            />
          </label>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Highlight color
        </TooltipContent>
      </Tooltip>
      <ToolbarButton
        label="Reset highlight color"
        icon={Ban}
        onAction={() => dispatch({ type: "SET_HIGHLIGHT", color: null })}
      />

      {/* Clear formatting: removes all inline character formatting
          (bold/italic/underline/strikethrough, color, highlight, font
          size/family, link) from the selection. Block-level attrs (type,
          alignment) are untouched. */}
      <ToolbarButton
        label="Clear formatting (Ctrl+\)"
        icon={RemoveFormatting}
        onAction={() => dispatch({ type: "CLEAR_FORMATTING" })}
      />

      <Separator orientation="vertical" className="mx-1 h-5 bg-[#c4c7c5]" />

      {/* Font family. Dispatches SET_FONT_FAMILY with the chosen family, which
          sets the per-run `fontFamily` attr (cascade → ComputedStyle.fontFamily
          → the shaper measures + the canvas renderer paints with it). The
          leading placeholder option is non-actionable (it just labels the
          control); selecting a real family applies it to the selection.
          onMouseDown/preventDefault keeps the editor's selection. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <select
            aria-label="Font family"
            className="h-7 rounded-sm bg-transparent px-1 text-xs text-[#444746] hover:bg-[#d3e3fd]"
            value=""
            onMouseDown={(e) => e.preventDefault()}
            onChange={(e) => {
              if (e.target.value !== "") {
                dispatch({ type: "SET_FONT_FAMILY", family: e.target.value });
              }
            }}
          >
            <option value="">Font</option>
            <option value="Arial">Arial</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Courier New">Courier New</option>
            <option value="Georgia">Georgia</option>
            <option value="Verdana">Verdana</option>
          </select>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Font family
        </TooltipContent>
      </Tooltip>

      {/* Font size (px). Dispatches SET_FONT_SIZE with the chosen size, which
          sets the per-run `fontSize` attr (cascade → ComputedStyle.fontSize →
          the IFC measures each run at that size, growing the line height to the
          MAX of its runs' block sizes). The leading placeholder option just
          labels the control. onMouseDown/preventDefault keeps the selection. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <select
            aria-label="Font size"
            className="h-7 rounded-sm bg-transparent px-1 text-xs text-[#444746] hover:bg-[#d3e3fd]"
            value=""
            onMouseDown={(e) => e.preventDefault()}
            onChange={(e) => {
              if (e.target.value !== "") {
                dispatch({ type: "SET_FONT_SIZE", size: Number(e.target.value) });
              }
            }}
          >
            <option value="">Size</option>
            <option value="10">10</option>
            <option value="12">12</option>
            <option value="14">14</option>
            <option value="16">16</option>
            <option value="18">18</option>
            <option value="24">24</option>
            <option value="32">32</option>
            <option value="48">48</option>
            <option value="64">64</option>
          </select>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Font size
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-5 bg-[#c4c7c5]" />

      {/* Text alignment. The active button reflects the focus block's current
          alignment ("start" when unset). Each dispatches SET_TEXT_ALIGN, which
          sets the per-block textAlign attr (paragraphs only — section/list
          containers are never aligned). */}
      <ToolbarToggle
        label="Align left"
        icon={AlignLeft}
        pressed={fmt.textAlign === "start"}
        onAction={() => dispatch({ type: "SET_TEXT_ALIGN", align: "start" })}
      />
      <ToolbarToggle
        label="Align center"
        icon={AlignCenter}
        pressed={fmt.textAlign === "center"}
        onAction={() => dispatch({ type: "SET_TEXT_ALIGN", align: "center" })}
      />
      <ToolbarToggle
        label="Align right"
        icon={AlignRight}
        pressed={fmt.textAlign === "end"}
        onAction={() => dispatch({ type: "SET_TEXT_ALIGN", align: "end" })}
      />
      <ToolbarToggle
        label="Justify"
        icon={AlignJustify}
        pressed={fmt.textAlign === "justify"}
        onAction={() => dispatch({ type: "SET_TEXT_ALIGN", align: "justify" })}
      />

      {/* Indent / outdent (Google Docs increase/decrease-indent). Each steps the
          focus/selected paragraph's marginInlineStart by one INDENT_STEP; the
          BFC insets the in-flow block and narrows its width, so it reflows.
          These are stateless actions (no pressed state), so they use
          ToolbarButton; onMouseDown/preventDefault keeps the selection. */}
      <ToolbarButton
        label="Decrease indent"
        icon={IndentDecrease}
        onAction={() => dispatch({ type: "OUTDENT" })}
      />
      <ToolbarButton
        label="Increase indent"
        icon={IndentIncrease}
        onAction={() => dispatch({ type: "INDENT" })}
      />

      {/* Line spacing (Google Docs' 1.0 / 1.15 / 1.5 / 2.0 control). Dispatches
          SET_LINE_SPACING with the chosen unitless multiplier, which sets the
          per-block `lineHeight` attr (paragraphs only — section/list containers
          are never spaced). The cascade resolves the ratio to a px line-height
          (ratio × fontSize) and the IFC honors it for each line box's height,
          so the paragraph reflows taller/shorter. The leading placeholder option
          just labels the control. onMouseDown/preventDefault keeps the
          selection. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <select
            aria-label="Line spacing"
            className="h-7 rounded-sm bg-transparent px-1 text-xs text-[#444746] hover:bg-[#d3e3fd]"
            value=""
            onMouseDown={(e) => e.preventDefault()}
            onChange={(e) => {
              if (e.target.value !== "") {
                dispatch({ type: "SET_LINE_SPACING", spacing: Number(e.target.value) });
              }
            }}
          >
            <option value="">Spacing</option>
            <option value="1">1.0</option>
            <option value="1.15">1.15</option>
            <option value="1.5">1.5</option>
            <option value="2">2.0</option>
          </select>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Line spacing
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-5 bg-[#c4c7c5]" />

      {/* List buttons */}
      <ToolbarButton
        label="Bulleted list"
        icon={List}
        onAction={() => dispatch({ type: "TOGGLE_LIST", listType: "unordered" })}
      />
      <ToolbarButton
        label="Numbered list"
        icon={ListOrdered}
        onAction={() => dispatch({ type: "TOGGLE_LIST", listType: "ordered" })}
      />

      <Separator orientation="vertical" className="mx-1 h-5 bg-[#c4c7c5]" />

      {/* Section break: starts a new section (each section begins on a fresh
          page). Inserts at the cursor's block boundary. */}
      <ToolbarButton
        label="Section break (new page)"
        icon={SeparatorHorizontal}
        onAction={() => dispatch({ type: "SECTION_BREAK" })}
      />

      {/* Toggle the page orientation of the SECTION at the cursor between the
          doc-wide page size and landscape (doc-wide dimensions swapped).
          No-op in a section-less doc — make a Section break first. */}
      <ToolbarButton
        label="Toggle section orientation"
        icon={RectangleHorizontal}
        onAction={() => dispatch({ type: "TOGGLE_SECTION_LANDSCAPE" })}
      />

      <Separator orientation="vertical" className="mx-1 h-5 bg-[#c4c7c5]" />

      {/* Insert a header / footer (one per document). Creates a one-paragraph
          template body that repeats in the page margin on every page, and
          places the caret in it so you can type immediately. Re-clicking moves
          the caret back into the existing header/footer (no duplicate). */}
      <ToolbarButton
        label="Insert header"
        icon={PanelTop}
        onAction={() => dispatch({ type: "INSERT_HEADER" })}
      />
      <ToolbarButton
        label="Insert footer"
        icon={PanelBottom}
        onAction={() => dispatch({ type: "INSERT_FOOTER" })}
      />

      {/* Insert a footnote at the cursor: splices a superscript call marker at
          the caret and creates an empty footnote body at the bottom of the
          page, moving the caret into the body so you can type immediately.
          Each click inserts a new footnote; markers renumber automatically. */}
      <ToolbarButton
        label="Insert footnote"
        icon={Superscript}
        onAction={() => dispatch({ type: "INSERT_FOOTNOTE" })}
      />

      {/* Footnote numbering reset policy (document-wide). Dispatches
          SET_FOOTNOTE_POLICY, which writes the reset attr onto the document
          root; render restarts numbering accordingly (restart-per-page runs
          the layout-dependent second pass). Controlled by the root's current
          policy. onMouseDown/preventDefault keeps the editor's selection. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <select
            aria-label="Footnote numbering"
            className="h-7 rounded-sm bg-transparent px-1 text-xs text-[#444746] hover:bg-[#d3e3fd]"
            value={footnoteReset}
            onMouseDown={(e) => e.preventDefault()}
            onChange={(e) =>
              dispatch({
                type: "SET_FOOTNOTE_POLICY",
                reset: e.target.value as FootnoteNumberingPolicy["reset"],
              })
            }
          >
            <option value="continuous">FN: continuous</option>
            <option value="restart-per-section">FN: per section</option>
            <option value="restart-per-page">FN: per page</option>
          </select>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Footnote numbering
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
