import { cn } from "@/lib/utils";

export type EditorMode = "print" | "digital" | "collab";

/**
 * The Print | Digital | Collab tab-bar. Print/Digital swap the editing BACKEND
 * (print canvas geometry ↔ digital browser-flowed DOM) over the SAME document —
 * the fork is downstream of core `State`. Collab renders two print editors over
 * ONE shared CRDT (Yjs) document to demonstrate live multi-peer editing. The
 * current document is handed off on switch.
 */
export function ModeTabs({
  mode,
  onChange,
}: {
  mode: EditorMode;
  onChange: (next: EditorMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-[#e0e0e0] bg-white px-4 py-1.5">
      {(["print", "digital", "collab"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
            mode === m
              ? "bg-[#e8f0fe] text-[#1a73e8]"
              : "text-[#5f6368] hover:bg-[#f1f3f4]",
          )}
        >
          {m}
        </button>
      ))}
      <span className="ml-2 text-xs text-[#80868b]">
        {mode === "print"
          ? "paginated canvas (@taleweaver/print)"
          : mode === "digital"
            ? "browser-flowed DOM (@taleweaver/digital)"
            : "two editors, one shared CRDT (Yjs)"}
      </span>
    </div>
  );
}
