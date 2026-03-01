import { useMemo } from "react";
import {
  Bold,
  Italic,
  Underline,
  Undo2,
  Redo2,
  List,
  ListOrdered,
  ChevronDown,
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
import type { EditorAction, EditorState } from "@taleweaver/dom";
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
    </div>
  );
}
