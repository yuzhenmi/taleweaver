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
  Square,
  Columns2,
  Columns3,
  PanelTop,
  PanelBottom,
  Superscript,
  Table,
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
import type { EditorAction, EditorState, FootnoteNumberingPolicy } from "@taleweaver/print";
import { documentFootnotePolicy } from "@taleweaver/print";
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

type FootnoteReset = FootnoteNumberingPolicy["reset"];

const FOOTNOTE_RESET_LABELS: Record<FootnoteReset, string> = {
  continuous: "FN: continuous",
  "restart-per-section": "FN: per section",
  "restart-per-page": "FN: per page",
};

const FOOTNOTE_RESET_OPTIONS: { reset: FootnoteReset; label: string }[] = [
  { reset: "continuous", label: FOOTNOTE_RESET_LABELS["continuous"] },
  { reset: "restart-per-section", label: FOOTNOTE_RESET_LABELS["restart-per-section"] },
  { reset: "restart-per-page", label: FOOTNOTE_RESET_LABELS["restart-per-page"] },
];

/**
 * `<input type="color">.value` accepts only a 7-char `#rrggbb` hex. The stored
 * color attr is set via that same control, so it's normally a valid hex — but
 * guard against other CSS color syntaxes (named colors, rgb()) to avoid React
 * resetting the input to black with a console warning.
 */
function isHexColor(value: string | null): value is string {
  return value !== null && /^#[0-9a-fA-F]{6}$/.test(value);
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
          // A controlled Radix Toggle with `pressed` but no `onPressedChange`
          // renders read-only: it sets `aria-pressed` but NOT `data-state`, so
          // a `data-[state=on]:` style never matches. Key the active style off
          // `aria-pressed` (the attribute that actually toggles); keep the
          // `data-[state=on]:` variants too so it's robust either way.
          className="h-7 w-7 rounded-sm text-[#444746] hover:bg-[#d3e3fd] aria-pressed:bg-[#d3e3fd] aria-pressed:text-[#1a73e8] data-[state=on]:bg-[#d3e3fd] data-[state=on]:text-[#1a73e8]"
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

/**
 * A Radix DropdownMenu trigger styled as a Google-Docs-style toolbar control:
 * a ghost button showing the current value + a chevron, wrapped in a Tooltip.
 * Unifies every toolbar dropdown onto one mechanism (consistent focus/open
 * semantics, no native-<select> quirks). The `onMouseDown preventDefault` on
 * the trigger Button keeps the editor's hidden textarea from blurring while the
 * menu opens — each DropdownMenuItem passed as `children` should do the same.
 */
function ToolbarDropdown({
  label,
  ariaLabel,
  display,
  children,
}: {
  label: string;
  ariaLabel: string;
  display: string;
  children: React.ReactNode;
}) {
  // Tooltip is the OUTERMOST context (matching ToolbarButton/ToolbarToggle):
  // nesting Tooltip inside DropdownMenu makes DropdownMenu.Root own the
  // TooltipTrigger subtree and can leave the tooltip stuck/flickering as the
  // menu opens. TooltipContent stays inside Tooltip (a sibling of DropdownMenu);
  // DropdownMenuContent stays inside DropdownMenu.
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              aria-label={ariaLabel}
              className="h-7 px-2 rounded-sm text-[#444746] hover:bg-[#d3e3fd] text-xs font-normal gap-1"
              onMouseDown={(e) => e.preventDefault()}
            >
              {display}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="start">{children}</DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function Toolbar({ dispatch, editorState }: ToolbarProps) {
  const fmt = useMemo(() => getFormatState(editorState), [editorState]);
  const blockLabel = getBlockTypeLabel(fmt.blockType, fmt.headingLevel);
  // Current document-wide footnote numbering reset policy (drives the footnote
  // dropdown's displayed label below). Read straight from the root block's attrs.
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
      <ToolbarDropdown label="Styles" ariaLabel="Styles" display={blockLabel}>
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
      </ToolbarDropdown>

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
              // <input type=color> can only show a valid hex (it has no "unset"
              // state), so reflect the active color when present, else default
              // to black. This drives the swatch the picker opens on.
              value={isHexColor(fmt.color) ? fmt.color : "#000000"}
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
              // Reflect the active highlight when present, else default to
              // yellow (the same caveat as text color: no "unset" state).
              value={
                isHexColor(fmt.backgroundColor) ? fmt.backgroundColor : "#ffff00"
              }
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
          trigger shows the active family (or "Font" when unset); each item
          previews itself in its own font-family. onMouseDown/preventDefault
          keeps the editor's selection. */}
      <ToolbarDropdown
        label="Font family"
        ariaLabel="Font family"
        display={fmt.fontFamily ?? "Font"}
      >
        {["Arial", "Times New Roman", "Courier New", "Georgia", "Verdana"].map(
          (f) => (
            <DropdownMenuItem
              key={f}
              onMouseDown={(e) => e.preventDefault()}
              onSelect={() => dispatch({ type: "SET_FONT_FAMILY", family: f })}
            >
              <span className="text-sm" style={{ fontFamily: f }}>
                {f}
              </span>
            </DropdownMenuItem>
          ),
        )}
      </ToolbarDropdown>

      {/* Font size (px). Dispatches SET_FONT_SIZE with the chosen size, which
          sets the per-run `fontSize` attr (cascade → ComputedStyle.fontSize →
          the IFC measures each run at that size, growing the line height to the
          MAX of its runs' block sizes). The trigger shows the active size (or
          "Size" when unset). onMouseDown/preventDefault keeps the selection. */}
      <ToolbarDropdown
        label="Font size"
        ariaLabel="Font size"
        display={fmt.fontSize !== null ? String(fmt.fontSize) : "Size"}
      >
        {[10, 12, 14, 16, 18, 24, 32, 48, 64].map((size) => (
          <DropdownMenuItem
            key={size}
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() => dispatch({ type: "SET_FONT_SIZE", size })}
          >
            {size}
          </DropdownMenuItem>
        ))}
      </ToolbarDropdown>

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
      <ToolbarDropdown
        label="Line spacing"
        ariaLabel="Line spacing"
        display={fmt.lineHeight !== null ? String(fmt.lineHeight) : "Spacing"}
      >
        {[
          { label: "1.0", value: 1 },
          { label: "1.15", value: 1.15 },
          { label: "1.5", value: 1.5 },
          { label: "2.0", value: 2 },
        ].map(({ label, value }) => (
          <DropdownMenuItem
            key={label}
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() => dispatch({ type: "SET_LINE_SPACING", spacing: value })}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </ToolbarDropdown>

      {/* Paragraph spacing (Google Docs' "Add space before / after paragraph").
          Each dispatches SET_PARAGRAPH_SPACING with the chosen px value, setting
          the per-block `marginBlockStart` (before) / `marginBlockEnd` (after)
          attr (paragraphs only — section/list containers are never spaced). The
          BFC applies the in-flow block margins WITH CSS collapsing, so the page
          reflows. "Default" (empty value) clears the attr → component default em
          margin. The leading placeholder option labels the control.
          onMouseDown/preventDefault keeps the selection. */}
      <ToolbarDropdown
        label="Space before paragraph"
        ariaLabel="Space before paragraph"
        display={fmt.spaceBefore !== null ? String(fmt.spaceBefore) : "Before"}
      >
        <DropdownMenuItem
          onMouseDown={(e) => e.preventDefault()}
          onSelect={() =>
            dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "before", value: null })
          }
        >
          Default
        </DropdownMenuItem>
        {[0, 8, 16, 24, 40].map((value) => (
          <DropdownMenuItem
            key={value}
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() =>
              dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "before", value })
            }
          >
            {value}
          </DropdownMenuItem>
        ))}
      </ToolbarDropdown>

      <ToolbarDropdown
        label="Space after paragraph"
        ariaLabel="Space after paragraph"
        display={fmt.spaceAfter !== null ? String(fmt.spaceAfter) : "After"}
      >
        <DropdownMenuItem
          onMouseDown={(e) => e.preventDefault()}
          onSelect={() =>
            dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "after", value: null })
          }
        >
          Default
        </DropdownMenuItem>
        {[0, 8, 16, 24, 40].map((value) => (
          <DropdownMenuItem
            key={value}
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() =>
              dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "after", value })
            }
          >
            {value}
          </DropdownMenuItem>
        ))}
      </ToolbarDropdown>

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

      {/* Multi-column layout (Format ▸ Columns) for the SECTION at the cursor,
          or doc-wide when there is no section break. 1 = single column; 2 / 3
          flow the content through that many equal-width columns. We omit
          `columnGap` so the engine's Google-Docs-parity default
          (`DEFAULT_COLUMN_GAP`, 0.5in / 48px) applies. */}
      <ToolbarButton
        label="One column"
        icon={Square}
        onAction={() => dispatch({ type: "SET_SECTION_COLUMNS", columnCount: 1 })}
      />
      <ToolbarButton
        label="Two columns"
        icon={Columns2}
        onAction={() => dispatch({ type: "SET_SECTION_COLUMNS", columnCount: 2 })}
      />
      <ToolbarButton
        label="Three columns"
        icon={Columns3}
        onAction={() => dispatch({ type: "SET_SECTION_COLUMNS", columnCount: 3 })}
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

      {/* Insert a 3×3 table at the cursor's block boundary (Google Docs Insert ▸
          Table; the demo uses a fixed default size). Splits the paragraph when
          the caret is mid-block, and moves the caret into the first cell so you
          can type immediately. Main-body only (no-op in a header/footer/footnote
          body). */}
      <ToolbarButton
        label="Insert table (3×3)"
        icon={Table}
        onAction={() => dispatch({ type: "INSERT_TABLE", rows: 3, cols: 3 })}
      />

      {/* Footnote numbering reset policy (document-wide). Dispatches
          SET_FOOTNOTE_POLICY, which writes the reset attr onto the document
          root; render restarts numbering accordingly (restart-per-page runs
          the layout-dependent second pass). Controlled by the root's current
          policy. onMouseDown/preventDefault keeps the editor's selection. */}
      <ToolbarDropdown
        label="Footnote numbering"
        ariaLabel="Footnote numbering"
        display={FOOTNOTE_RESET_LABELS[footnoteReset]}
      >
        {FOOTNOTE_RESET_OPTIONS.map(({ reset, label }) => (
          <DropdownMenuItem
            key={reset}
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() => dispatch({ type: "SET_FOOTNOTE_POLICY", reset })}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </ToolbarDropdown>
    </div>
  );
}
