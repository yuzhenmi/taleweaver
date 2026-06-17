import { useEffect, useRef, useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  X,
  CaseSensitive,
  WholeWord,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { EditorViewHandle } from "@taleweaver/react";
import type { EditorState, FindMatchesOptions } from "@taleweaver/print";

/**
 * The Google-Docs-style floating find/replace bar (#433 slice 6, sub-slice B).
 *
 * It is a thin UI shell over the already-shipped `EditorViewHandle`: the
 * controller owns the find session (matches + activeIndex), so this component
 * holds only its own input state (query / replacement / options) and DRIVES the
 * handle. The authoritative "n of N" is read from `handle.findStatus()` during
 * render — the parent re-renders this bar whenever `editorState` changes (a new
 * `editorState` prop), so the count auto-refreshes the render AFTER any edit,
 * replace, or navigation, with no stale-status hack (per the design's reviewer
 * correction #3).
 */
export interface FindBarProps {
  handle: EditorViewHandle;
  mode: "find" | "replace";
  onClose: () => void;
  /**
   * Passed solely so a doc change re-renders the bar → it re-polls
   * `handle.findStatus()` for the live count. Not otherwise read.
   */
  editorState: EditorState;
}

const DEBOUNCE_MS = 150;

interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

function toMatchOptions(options: FindOptions): FindMatchesOptions {
  return { caseSensitive: options.caseSensitive, wholeWord: options.wholeWord };
}

export function FindBar({
  handle,
  mode,
  onClose,
  // `editorState` is intentionally unused in the body: it exists only as a prop
  // dependency so React re-renders this bar whenever the doc changes, which
  // re-polls `handle.findStatus()` for the live count (see the component
  // docstring). Renamed to satisfy noUnusedParameters.
  editorState: _editorState,
}: FindBarProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState<FindOptions>({
    caseSensitive: false,
    wholeWord: false,
  });

  const findInputRef = useRef<HTMLInputElement>(null);

  // Focus + select the find input on mount AND whenever the mode changes (e.g.
  // pressing Ctrl+F while the bar is already open in replace mode flips `mode`):
  // re-focusing and selecting lets the user immediately retype the query, which
  // matches Google Docs.
  useEffect(() => {
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [mode]);

  // Debounced re-query: whenever the (non-empty) query or options change,
  // (re)start the find session after ~150ms of quiet. The controller's
  // `findStart` is idempotent on the same query/options, so re-running on every
  // option toggle is cheap + correct. An empty query is handled by the separate
  // effect below (this one no-ops), so toggling an option while the query is
  // empty doesn't fire a redundant `findClose`.
  useEffect(() => {
    if (query === "") return;
    const timer = window.setTimeout(() => {
      handle.findStart(query, toMatchOptions(options));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, options, handle]);

  // Clear the session's highlights the moment the query becomes empty. Keyed on
  // `[query, handle]` (NOT options), so it only fires when the query itself
  // changes — never on an option toggle while the query is already empty.
  useEffect(() => {
    if (query === "") handle.findClose();
  }, [query, handle]);

  // Close the session's highlights when the bar unmounts (e.g. parent drops it
  // without an explicit Escape/×). The explicit close paths also call this, but
  // this guards the unmount-without-close case so highlights never leak.
  useEffect(() => {
    return () => handle.findClose();
  }, [handle]);

  const close = () => {
    handle.findClose();
    onClose();
  };

  // Authoritative count: read from the controller on EVERY render (see the
  // component docstring). `editorState` is a prop dependency that forces a
  // re-render after any doc change, so this stays current.
  const status = handle.findStatus();
  const countLabel = formatCount(query, status.total, status.activeIndex);

  // Shared key handler for BOTH the find input and the replace input, so
  // Enter/Shift+Enter and the arrow keys navigate matches from either field and
  // Escape closes from either — matching Google Docs. Branches are kept explicit
  // (one key per branch) so the Enter-vs-ArrowDown intent is legible.
  const handleNavKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        handle.findPrev();
      } else {
        handle.findNext();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      handle.findNext();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      handle.findPrev();
      return;
    }
  };

  const toggleOption = (key: keyof FindOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div
      // `fixed` so the bar stays pinned to the top-right while the document
      // scrolls underneath it (Google Docs keeps the find bar persistently
      // visible). Positioned relative to the viewport, just under the toolbar.
      className="fixed right-6 top-32 z-20 flex flex-col gap-1.5 rounded-lg border border-[#dadce0] bg-white px-3 py-2 shadow-lg"
      // Keep clicks inside the bar from blurring/moving the editor's caret.
      onMouseDown={(e) => {
        // Only preventDefault on non-input targets — inputs need to keep their
        // native focus/caret behavior so the user can click between fields.
        if (!(e.target instanceof HTMLInputElement)) {
          e.preventDefault();
        }
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={findInputRef}
          type="text"
          aria-label="Find in document"
          placeholder="Find"
          className="h-7 w-48 rounded-sm border border-[#dadce0] px-2 text-sm text-[#202124] outline-none focus:border-[#1a73e8]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleNavKeyDown}
        />
        <span className="min-w-16 text-xs text-[#5f6368] tabular-nums">
          {countLabel}
        </span>

        <FindIconButton
          label="Previous match (Shift+Enter)"
          icon={ChevronUp}
          onAction={() => handle.findPrev()}
        />
        <FindIconButton
          label="Next match (Enter)"
          icon={ChevronDown}
          onAction={() => handle.findNext()}
        />

        <FindOptionToggle
          label="Match case"
          icon={CaseSensitive}
          pressed={options.caseSensitive}
          onAction={() => toggleOption("caseSensitive")}
        />
        <FindOptionToggle
          label="Match whole word"
          icon={WholeWord}
          pressed={options.wholeWord}
          onAction={() => toggleOption("wholeWord")}
        />

        <FindIconButton label="Close (Esc)" icon={X} onAction={close} />
      </div>

      {mode === "replace" && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            aria-label="Replace with"
            placeholder="Replace with"
            className="h-7 w-48 rounded-sm border border-[#dadce0] px-2 text-sm text-[#202124] outline-none focus:border-[#1a73e8]"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={handleNavKeyDown}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-sm px-2 text-xs font-normal text-[#1a73e8] hover:bg-[#d3e3fd]"
            // Fire on mouseDown (after preventDefault) so the action runs before
            // any focus-blur — mirrors ToolbarButton in toolbar.tsx.
            onMouseDown={(e) => {
              e.preventDefault();
              handle.replaceActive(replacement);
            }}
          >
            Replace
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-sm px-2 text-xs font-normal text-[#1a73e8] hover:bg-[#d3e3fd]"
            // Fire on mouseDown (after preventDefault) so the action runs before
            // any focus-blur — mirrors ToolbarButton in toolbar.tsx.
            onMouseDown={(e) => {
              e.preventDefault();
              handle.replaceAll(replacement);
            }}
          >
            Replace all
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Derive the "n of N" label per the FindStatus contract:
 * - empty query → no label (the count is meaningless before a search).
 * - `total === 0` → "No results".
 * - `activeIndex < 0` but matches exist → "– of N" (none emphasized yet; the
 *   FindStatus JSDoc defines activeIndex -1 as "no active match").
 * - otherwise → "(activeIndex + 1) of N".
 */
function formatCount(query: string, total: number, activeIndex: number): string {
  if (query === "") return "";
  if (total === 0) return "No results";
  if (activeIndex < 0) return `– of ${total}`;
  return `${activeIndex + 1} of ${total}`;
}

function FindIconButton({
  label,
  icon: Icon,
  onAction,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onAction: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-sm text-[#444746] hover:bg-[#d3e3fd]"
          // Fire on mouseDown (after preventDefault) so the action runs before
          // focus-blur — mirrors ToolbarButton in toolbar.tsx.
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

function FindOptionToggle({
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
          aria-label={label}
          // A controlled Radix Toggle with `pressed` but no `onPressedChange`
          // renders read-only (sets `aria-pressed` but NOT `data-state`), so the
          // active style keys off `aria-pressed`. Fire the toggle in onMouseDown
          // after preventDefault — mirrors ToolbarToggle in toolbar.tsx.
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
